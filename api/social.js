// social.js
//
// Tudo que é "tempo real" e não é o 1:1 aleatório do matchmaking.js:
//   1) Presença: sabemos quais usuários logados estão online agora
//      (guardado no Redis como um Set de socket.id por userId — assim
//      funciona mesmo se você tiver mais de uma aba/dispositivo aberto,
//      e continua funcionando se um dia rodar mais de uma instância do
//      backend no Railway).
//   2) Pedido de amizade "ao vivo": o botão "Adicionar amigo" dentro da
//      chamada usa o peerUserId que o matchmaking.js já guardou.
//   3) Chamada em grupo com amigos (até 4 pessoas): usamos WebRTC em
//      malha (mesh) — cada participante abre uma RTCPeerConnection direta
//      com cada um dos outros. Com um teto de 4 pessoas isso dá no máximo
//      6 conexões simultâneas, o que é tranquilo sem precisar de um
//      servidor de mídia (SFU). Se um dia o limite subir bastante (10+),
//      aí sim vale migrar para um SFU (ex: mediasoup, LiveKit).
//
// O servidor NUNCA vê o vídeo/áudio da chamada em grupo — só ajuda os
// participantes a se encontrarem e repassa a sinalização, igual ao 1:1.

const { randomUUID } = require('crypto');
const pool = require('./db');
const { createFriendRequestByIds } = require('./friendController');

const GROUP_ROOM_MAX_PARTICIPANTS = 4;
const presenceKey = (userId) => `presence:user:${userId}`;
const groupRoomKey = (roomId) => `grouproom:${roomId}`; // Set de socket.id
const groupRoomOwnerKey = (roomId) => `grouproom:${roomId}:owner`;

function registerSocialHandlers(io, redisClient) {
  io.on('connection', (socket) => {
    const userId = socket.data.userId; // já verificado pelo matchmaking.js

    // ------------------------------------------------------------------
    // PRESENÇA
    // ------------------------------------------------------------------
    if (userId) {
      redisClient.sAdd(presenceKey(userId), socket.id).catch((err) =>
        console.error('[Social] Erro ao marcar presença:', err)
      );
    }

    /** Envia um evento para TODAS as sessões abertas de um usuário (se estiver online). */
    async function emitToUser(targetUserId, event, payload) {
      const socketIds = await redisClient.sMembers(presenceKey(targetUserId));
      for (const sid of socketIds) {
        io.to(sid).emit(event, payload);
      }
      return socketIds.length > 0;
    }

    // ------------------------------------------------------------------
    // AMIGOS — pedido enviado durante uma chamada 1:1 (botão na CallScreen)
    // ------------------------------------------------------------------
    socket.on('add_friend_incall', async () => {
      try {
        if (!userId) {
          return socket.emit('friend_error', { message: 'Faça login para adicionar amigos.' });
        }
        const peerUserId = socket.data.peerUserId;
        if (!peerUserId) {
          return socket.emit('friend_error', { message: 'O outro usuário não está logado ou já saiu.' });
        }

        const result = await createFriendRequestByIds(userId, peerUserId);
        if (result.alreadyExists) {
          return socket.emit('friend_error', {
            message: result.status === 'accepted' ? 'Vocês já são amigos.' : 'Já existe um pedido pendente.',
          });
        }

        socket.emit('friend_request_sent', { toUserId: peerUserId });

        const userRow = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        await emitToUser(peerUserId, 'friend_request_received', {
          friendshipId: result.friendshipId,
          fromUserId: userId,
          fromUsername: userRow.rows[0]?.username || 'alguém',
        });
      } catch (err) {
        console.error('[Social] Erro em add_friend_incall:', err);
        socket.emit('friend_error', { message: 'Erro ao enviar pedido de amizade.' });
      }
    });

    // ------------------------------------------------------------------
    // CHAMADA EM GRUPO (mesh, até 4 participantes)
    // ------------------------------------------------------------------

    /**
     * Cria (se necessário) uma sala de grupo e convida um amigo.
     * payload: { targetUserId, roomId? }
     * Se roomId não vier, uma nova sala é criada e quem chamou entra nela.
     */
    socket.on('group_call_invite', async ({ targetUserId, roomId } = {}) => {
      try {
        if (!userId) return socket.emit('group_call_error', { message: 'Faça login para chamadas em grupo.' });

        // Confere amizade aceita nos dois sentidos
        const friendship = await pool.query(
          `SELECT id FROM friendships WHERE status = 'accepted'
             AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
          [userId, targetUserId]
        );
        if (friendship.rowCount === 0) {
          return socket.emit('group_call_error', { message: 'Vocês precisam ser amigos para chamar.' });
        }

        let activeRoomId = roomId;
        if (!activeRoomId) {
          activeRoomId = `group_${randomUUID()}`;
          await redisClient.sAdd(groupRoomKey(activeRoomId), socket.id);
          await redisClient.set(groupRoomOwnerKey(activeRoomId), String(userId));
          socket.join(activeRoomId);
          socket.data.groupRoomId = activeRoomId;
        }

        const currentSize = await redisClient.sCard(groupRoomKey(activeRoomId));
        if (currentSize >= GROUP_ROOM_MAX_PARTICIPANTS) {
          return socket.emit('group_call_error', { message: 'Essa chamada já está com o máximo de 4 pessoas.' });
        }

        const userRow = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        const delivered = await emitToUser(targetUserId, 'group_call_invite_received', {
          roomId: activeRoomId,
          fromUserId: userId,
          fromUsername: userRow.rows[0]?.username || 'alguém',
        });

        socket.emit('group_call_room', { roomId: activeRoomId, delivered });
      } catch (err) {
        console.error('[Social] Erro em group_call_invite:', err);
        socket.emit('group_call_error', { message: 'Erro ao convidar para a chamada.' });
      }
    });

    /**
     * Amigo convidado aceita ou recusa.
     * payload: { roomId, accept }
     */
    socket.on('group_call_respond', async ({ roomId, accept } = {}) => {
      try {
        if (!accept) {
          return socket.to(roomId).emit('group_call_invite_declined', { userId });
        }

        const size = await redisClient.sCard(groupRoomKey(roomId));
        if (size >= GROUP_ROOM_MAX_PARTICIPANTS) {
          return socket.emit('group_call_error', { message: 'Essa chamada já está cheia.' });
        }

        // Lista de quem já está na sala ANTES de mim entrar — é pra eles
        // que eu (recém-chegado) vou criar as offers WebRTC.
        const existingSocketIds = await redisClient.sMembers(groupRoomKey(roomId));

        await redisClient.sAdd(groupRoomKey(roomId), socket.id);
        socket.join(roomId);
        socket.data.groupRoomId = roomId;

        const userRow = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);

        socket.emit('group_call_joined', {
          roomId,
          existingPeers: existingSocketIds, // [socketId, ...] — o recém-chegado inicia a conexão com cada um
        });

        socket.to(roomId).emit('group_call_peer_joined', {
          socketId: socket.id,
          userId,
          username: userRow.rows[0]?.username || 'alguém',
        });
      } catch (err) {
        console.error('[Social] Erro em group_call_respond:', err);
        socket.emit('group_call_error', { message: 'Erro ao entrar na chamada.' });
      }
    });

    async function leaveGroupRoom() {
      const roomId = socket.data.groupRoomId;
      if (!roomId) return;
      await redisClient.sRem(groupRoomKey(roomId), socket.id);
      socket.to(roomId).emit('group_call_peer_left', { socketId: socket.id });
      socket.leave(roomId);
      socket.data.groupRoomId = null;

      const remaining = await redisClient.sCard(groupRoomKey(roomId));
      if (remaining === 0) {
        await redisClient.del(groupRoomKey(roomId));
        await redisClient.del(groupRoomOwnerKey(roomId));
      }
    }

    socket.on('group_call_leave', leaveGroupRoom);

    // Sinalização WebRTC da malha — sempre direcionada a UM socket específico
    // (targetSocketId), diferente do 1:1 que usa a room inteira.
    socket.on('group_webrtc_offer', ({ targetSocketId, offer }) => {
      io.to(targetSocketId).emit('group_webrtc_offer', { offer, from: socket.id });
    });
    socket.on('group_webrtc_answer', ({ targetSocketId, answer }) => {
      io.to(targetSocketId).emit('group_webrtc_answer', { answer, from: socket.id });
    });
    socket.on('group_webrtc_ice_candidate', ({ targetSocketId, candidate }) => {
      io.to(targetSocketId).emit('group_webrtc_ice_candidate', { candidate, from: socket.id });
    });

    socket.on('disconnect', async () => {
      if (userId) {
        redisClient.sRem(presenceKey(userId), socket.id).catch(() => {});
      }
      await leaveGroupRoom();
    });
  });
}

module.exports = { registerSocialHandlers };
