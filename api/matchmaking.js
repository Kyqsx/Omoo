// src/sockets/matchmaking.js
//
// Coração do sistema de pareamento (matchmaking).
//
// Conceito geral:
// - Cada "fila" é uma LISTA no Redis (ex: "fila:geral", "fila:pais:brasil").
// - Quando um usuário procura um match, colocamos seu socket.id no FINAL
//   dessa lista (RPUSH).
// - Imediatamente tentamos "casar" gente: se a fila tem 2 ou mais pessoas,
//   removemos as duas primeiras (LPOP) e criamos uma sala privada para elas.
// - Não usamos um "loop infinito" rodando sozinho (isso desperdiça CPU).
//   Em vez disso, tentamos parear TODA VEZ que alguém entra na fila —
//   o que na prática tem o mesmo efeito e é muito mais eficiente.
//
// Sala privada:
// - Usamos as "rooms" nativas do Socket.io. Cada par ganha um room ID único
//   (ex: "room_ab12cd"). Os dois sockets entram nesse room e o servidor
//   avisa cada um o ID do parceiro, para o frontend iniciar o WebRTC.

const { randomUUID } = require('crypto');
const pool = require('./db');
const { verifyToken } = require('./authController');

// Prefixo padrão usado nas chaves de fila do Redis.
const QUEUE_GERAL = 'fila:geral';

/**
 * Monta o nome da chave de fila filtrada, ex: "fila:pais:brasil" ou
 * "fila:genero:feminino". Mantemos tudo em minúsculo para evitar filas
 * duplicadas por causa de maiúsculas/minúsculas.
 */
function buildFilteredQueueKey(filterType, filterValue) {
  return `fila:${filterType}:${String(filterValue).toLowerCase()}`;
}

/**
 * Consulta no PostgreSQL se o usuário é Premium.
 * Retorna `false` (trata como Free) se o usuário não existir/erro,
 * por segurança — nunca liberamos filtro premium por padrão.
 */
async function isUserPremium(userId) {
  if (!userId) return false;
  try {
    const result = await pool.query('SELECT is_premium FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.is_premium === true;
  } catch (err) {
    console.error('[Matchmaking] Erro ao verificar status premium:', err);
    return false;
  }
}

/**
 * Tenta parear duas pessoas da mesma fila. Se conseguir, cria a sala e
 * avisa os dois sockets. Essa função é chamada sempre que alguém entra
 * numa fila.
 */
async function tryMatch(io, redisClient, queueKey) {
  // LLEN = tamanho atual da lista/fila no Redis
  const queueSize = await redisClient.lLen(queueKey);
  if (queueSize < 2) return; // precisa de pelo menos 2 pessoas para parear

  // Remove os dois primeiros da fila (FIFO: quem chegou primeiro é pareado primeiro)
  const socketIdA = await redisClient.lPop(queueKey);
  const socketIdB = await redisClient.lPop(queueKey);

  if (!socketIdA || !socketIdB) return; // corrida rara: outro processo já pegou

  const socketA = io.sockets.sockets.get(socketIdA);
  const socketB = io.sockets.sockets.get(socketIdB);

  // Se algum dos dois já se desconectou entre o RPUSH e agora, devolve
  // o outro para a fila e tenta de novo.
  if (!socketA && socketB) {
    await redisClient.lPush(queueKey, socketIdB);
    return;
  }
  if (!socketB && socketA) {
    await redisClient.lPush(queueKey, socketIdA);
    return;
  }
  if (!socketA && !socketB) return;

  // Cria uma sala privada única para esse par
  const roomId = `room_${randomUUID()}`;
  socketA.join(roomId);
  socketB.join(roomId);

  // Guardamos o roomId no próprio socket, útil para limpeza no disconnect
  socketA.data.roomId = roomId;
  socketB.data.roomId = roomId;

  // Guardamos quem é o par de cada um — necessário pro botão de denúncia,
  // que precisa saber "quem eu estava conversando" mesmo depois de o
  // parceiro sair da sala.
  socketA.data.peerSocketId = socketB.id;
  socketA.data.peerUserId = socketB.data.userId || null;
  socketB.data.peerSocketId = socketA.id;
  socketB.data.peerUserId = socketA.data.userId || null;

  // Avisa cada lado quem é o "peer" (parceiro) e o roomId.
  // O frontend usa isso para iniciar a conexão WebRTC (criar RTCPeerConnection,
  // gerar "offer", etc). Definimos socketA como "iniciador" da chamada
  // (quem cria a offer primeiro) só para evitar que os dois criem offer ao
  // mesmo tempo.
  socketA.emit('match_found', { roomId, peerId: socketB.id, initiator: true });
  socketB.emit('match_found', { roomId, peerId: socketA.id, initiator: false });

  console.log(`[Matchmaking] Sala ${roomId} criada para ${socketA.id} <-> ${socketB.id}`);
}

/**
 * Remove um socket de todas as filas em que ele possa estar esperando.
 * Chamado quando o usuário desiste da busca ou desconecta.
 * Como não sabemos de antemão em qual fila ele está, guardamos a fila
 * atual em socket.data.currentQueue ao entrar nela.
 */
async function leaveQueue(redisClient, socket) {
  const queueKey = socket.data.currentQueue;
  if (!queueKey) return;

  // LREM remove todas as ocorrências do socket.id nessa lista
  await redisClient.lRem(queueKey, 0, socket.id);
  socket.data.currentQueue = null;
}

/**
 * Função principal exportada. Recebe a instância do Socket.io e o cliente
 * Redis (já conectado) e registra todos os eventos.
 */
function registerMatchmakingHandlers(io, redisClient) {
  io.on('connection', (socket) => {
    // Autenticação opcional: usuários Free continuam funcionando sem token
    // (chat anônimo). Se um token válido vier no handshake, guardamos o
    // userId real no socket — é ele que vamos confiar dali pra frente,
    // nunca o que o cliente disser depois em outros eventos.
    const token = socket.handshake.auth?.token;
    const payload = verifyToken(token);
    socket.data.userId = payload?.userId || null;

    console.log(
      `[Socket.io] Novo cliente conectado: ${socket.id}` +
        (socket.data.userId ? ` (usuário #${socket.data.userId})` : ' (anônimo)')
    );

    /**
     * Evento disparado pelo frontend quando o usuário clica em
     * "Iniciar chat" / "Próximo".
     *
     * payload esperado:
     * {
     *   filters: { country: 'brasil' } // só usado se for Premium
     * }
     *
     * O userId NÃO vem mais do payload — vem do token JWT verificado na
     * conexão (socket.data.userId). Isso evita que alguém finja ser
     * Premium só mandando um ID qualquer no payload.
     */
    socket.on('find_match', async (payload = {}) => {
      try {
        const { filters } = payload;
        const userId = socket.data.userId;

        const premium = await isUserPremium(userId);

        let queueKey = QUEUE_GERAL;

        if (premium && filters && Object.keys(filters).length > 0) {
          // Por simplicidade, usamos o PRIMEIRO filtro informado para montar
          // a chave da fila (ex: { country: 'brasil' } -> "fila:country:brasil").
          // Se quiser combinar múltiplos filtros, dá para concatenar tudo na
          // chave, ex: "fila:country:brasil:gender:feminino".
          const [filterType, filterValue] = Object.entries(filters)[0];
          queueKey = buildFilteredQueueKey(filterType, filterValue);
        }
        // Se for Free (ou Premium sem filtro), cai na fila geral.

        socket.data.currentQueue = queueKey;
        await redisClient.rPush(queueKey, socket.id);
        console.log(`[Matchmaking] ${socket.id} entrou na fila "${queueKey}"`);

        // Tenta parear imediatamente
        await tryMatch(io, redisClient, queueKey);
      } catch (err) {
        console.error('[Matchmaking] Erro em find_match:', err);
        socket.emit('match_error', { message: 'Erro ao procurar um par.' });
      }
    });

    /**
     * Usuário cancelou a busca antes de encontrar alguém
     * (ex: fechou a aba ou clicou em "cancelar").
     */
    socket.on('cancel_find', async () => {
      await leaveQueue(redisClient, socket);
    });

    // ------------------------------------------------------------------
    // RELAY DE SINALIZAÇÃO WEBRTC
    // O servidor NÃO participa da chamada de vídeo em si (isso é P2P entre
    // os dois navegadores). Ele só repassa as mensagens de "negociação"
    // (offer/answer/ice candidates) de um lado para o outro dentro da room.
    // ------------------------------------------------------------------
    socket.on('webrtc_offer', ({ roomId, offer }) => {
      socket.to(roomId).emit('webrtc_offer', { offer, from: socket.id });
    });

    socket.on('webrtc_answer', ({ roomId, answer }) => {
      socket.to(roomId).emit('webrtc_answer', { answer, from: socket.id });
    });

    socket.on('webrtc_ice_candidate', ({ roomId, candidate }) => {
      socket.to(roomId).emit('webrtc_ice_candidate', { candidate, from: socket.id });
    });

    // Chat de texto simples dentro da sala (opcional, mas citado no requisito)
    socket.on('chat_message', ({ roomId, message }) => {
      socket.to(roomId).emit('chat_message', { message, from: socket.id });
    });

    /**
     * Denúncia do parceiro atual (ou do último parceiro, caso ele já
     * tenha saído da sala). Guarda no banco pra moderação revisar depois.
     *
     * payload esperado: { reason: 'nudez' | 'assedio' | 'spam' | 'outro', details?: string }
     */
    socket.on('report_user', async (payload = {}) => {
      try {
        const { reason, details } = payload;
        const validReasons = ['nudez', 'assedio', 'spam', 'menor_de_idade', 'outro'];

        if (!reason || !validReasons.includes(reason)) {
          socket.emit('report_error', { message: 'Motivo de denúncia inválido.' });
          return;
        }

        const peerSocketId = socket.data.peerSocketId;
        if (!peerSocketId) {
          socket.emit('report_error', { message: 'Não há ninguém para denunciar agora.' });
          return;
        }

        await pool.query(
          `INSERT INTO reports
             (room_id, reporter_user_id, reporter_socket_id, reported_user_id, reported_socket_id, reason, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            socket.data.roomId || 'sala_encerrada',
            socket.data.userId,
            socket.id,
            socket.data.peerUserId,
            peerSocketId,
            reason,
            details || null,
          ]
        );

        console.log(`[Report] ${socket.id} denunciou ${peerSocketId} por "${reason}"`);
        socket.emit('report_submitted');
      } catch (err) {
        console.error('[Matchmaking] Erro ao registrar denúncia:', err);
        socket.emit('report_error', { message: 'Erro ao enviar denúncia.' });
      }
    });

    // Usuário quer encerrar o chat atual e o parceiro deve ser avisado
    socket.on('leave_room', () => {
      const roomId = socket.data.roomId;
      if (roomId) {
        socket.to(roomId).emit('peer_left');
        socket.leave(roomId);
        socket.data.roomId = null;
      }
    });

    socket.on('disconnect', async () => {
      console.log(`[Socket.io] Cliente desconectado: ${socket.id}`);
      await leaveQueue(redisClient, socket);

      const roomId = socket.data.roomId;
      if (roomId) {
        socket.to(roomId).emit('peer_left');
      }
    });
  });
}

module.exports = { registerMatchmakingHandlers };
