// src/App.jsx
//
// Controla em qual "tela" o usuário está: lobby -> searching -> call
// (e agora também friends / groupcall). Também gerencia a sessão
// (usuário logado ou não), o checkout Premium, e as notificações em
// tempo real de amigos/chamada em grupo.

import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './lib/socket';
import { fetchCurrentUser, getToken } from './lib/auth';
import Lobby from './components/Lobby';
import Searching from './components/Searching';
import CallScreen from './components/CallScreen';
import AuthModal from './components/AuthModal';
import FriendsPanel from './components/FriendsPanel';
import GroupCallScreen from './components/GroupCallScreen';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export default function App() {
  const [screen, setScreen] = useState('lobby'); // 'lobby' | 'searching' | 'call' | 'groupcall'
  const [match, setMatch] = useState(null); // { roomId, peerId, initiator }
  const [groupRoomId, setGroupRoomId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const [user, setUser] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  const [friendToast, setFriendToast] = useState('');
  const [incomingGroupInvite, setIncomingGroupInvite] = useState(null); // { roomId, fromUserId, fromUsername }

  // Guarda os últimos filtros usados, para o botão "Próximo" repetir a
  // mesma busca sem o usuário precisar reconfigurar tudo de novo.
  const lastFiltersRef = useRef({});

  // Ao abrir o app, tenta recuperar a sessão a partir do token salvo.
  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (u) setUser(u);
    });
  }, []);

  // O socket fica conectado desde que o app abre (não só durante a busca):
  // isso é necessário pra receber pedidos de amizade e convites de chamada
  // em grupo em tempo real, mesmo enquanto o usuário está só navegando.
  useEffect(() => {
    if (!socket.connected) socket.connect();

    function onConnect() {
      console.log('[Socket] conectado ->', socket.id);
    }
    function onDisconnect(reason) {
      console.log('[Socket] desconectado ->', reason);
    }
    function onConnectError(err) {
      console.error('[Socket] erro de conexão ->', err.message);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
    };
  }, []);

  const startSearch = useCallback((filters = {}) => {
    lastFiltersRef.current = filters;
    setErrorMsg('');
    setMatch(null);
    setScreen('searching');
    socket.emit('find_match', { filters });
  }, []);

  useEffect(() => {
    function onMatchFound(data) {
      console.log('[App] match_found ->', data);
      setMatch(data);
      setScreen('call');
    }

    function onMatchError({ message }) {
      setErrorMsg(message || 'Não foi possível procurar um par agora.');
      setScreen('lobby');
    }

    // O outro lado saiu da chamada. Voltamos automaticamente pra busca.
    function onPeerLeft() {
      setMatch(null);
      startSearch(lastFiltersRef.current);
    }

    function onFriendRequestReceived({ fromUsername }) {
      setFriendToast(`@${fromUsername} te enviou um pedido de amizade.`);
      setTimeout(() => setFriendToast(''), 5000);
    }

    function onGroupCallRoom({ roomId }) {
      setGroupRoomId(roomId);
      setScreen('groupcall');
    }

    function onGroupInviteReceived({ roomId, fromUserId, fromUsername }) {
      setIncomingGroupInvite({ roomId, fromUserId, fromUsername });
    }

    function onGroupCallError({ message }) {
      setErrorMsg(message);
    }

    socket.on('match_found', onMatchFound);
    socket.on('match_error', onMatchError);
    socket.on('peer_left', onPeerLeft);
    socket.on('friend_request_received', onFriendRequestReceived);
    socket.on('group_call_room', onGroupCallRoom);
    socket.on('group_call_invite_received', onGroupInviteReceived);
    socket.on('group_call_error', onGroupCallError);

    return () => {
      socket.off('match_found', onMatchFound);
      socket.off('match_error', onMatchError);
      socket.off('peer_left', onPeerLeft);
      socket.off('friend_request_received', onFriendRequestReceived);
      socket.off('group_call_room', onGroupCallRoom);
      socket.off('group_call_invite_received', onGroupInviteReceived);
      socket.off('group_call_error', onGroupCallError);
    };
  }, [startSearch]);

  const cancelSearch = useCallback(() => {
    socket.emit('cancel_find');
    setScreen('lobby');
  }, []);

  const nextMatch = useCallback(() => {
    socket.emit('leave_room');
    startSearch(lastFiltersRef.current);
  }, [startSearch]);

  const endCall = useCallback(() => {
    socket.emit('leave_room');
    setMatch(null);
    setScreen('lobby');
  }, []);

  const startGroupCall = useCallback((friend) => {
    socket.emit('group_call_invite', { targetUserId: friend.id });
    setFriendsOpen(false);
  }, []);

  const acceptGroupInvite = useCallback(() => {
    if (!incomingGroupInvite) return;
    socket.emit('group_call_respond', { roomId: incomingGroupInvite.roomId, accept: true });
    setGroupRoomId(incomingGroupInvite.roomId);
    setScreen('groupcall');
    setIncomingGroupInvite(null);
  }, [incomingGroupInvite]);

  const declineGroupInvite = useCallback(() => {
    if (!incomingGroupInvite) return;
    socket.emit('group_call_respond', { roomId: incomingGroupInvite.roomId, accept: false });
    setIncomingGroupInvite(null);
  }, [incomingGroupInvite]);

  const leaveGroupCall = useCallback(() => {
    setGroupRoomId(null);
    setScreen('lobby');
  }, []);

  const handleSubscribe = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setAuthModalOpen(true);
      return;
    }
    setSubscribing(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao iniciar checkout.');
      window.location.href = data.checkoutUrl; // redireciona pro Stripe
    } catch (err) {
      setErrorMsg(err.message);
      setSubscribing(false);
    }
  }, []);

  return (
    <div className="app-shell">
      <div className="brand">
        <span className="brand-dot" />
        Sinal
      </div>

      {screen === 'lobby' && (
        <Lobby
          onStart={startSearch}
          errorMsg={errorMsg}
          user={user}
          onOpenAuth={() => setAuthModalOpen(true)}
          onOpenFriends={() => setFriendsOpen(true)}
          onSubscribe={handleSubscribe}
          subscribing={subscribing}
        />
      )}
      {screen === 'searching' && <Searching onCancel={cancelSearch} />}
      {screen === 'call' && match && (
        <CallScreen
          key={match.roomId}
          roomId={match.roomId}
          initiator={match.initiator}
          isLoggedIn={!!user}
          onNext={nextMatch}
          onEnd={endCall}
        />
      )}
      {screen === 'groupcall' && groupRoomId && (
        <GroupCallScreen key={groupRoomId} roomId={groupRoomId} onLeave={leaveGroupCall} />
      )}

      {authModalOpen && (
        <AuthModal
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={(u) => {
            setUser(u);
            setAuthModalOpen(false);
          }}
        />
      )}

      {friendsOpen && <FriendsPanel onClose={() => setFriendsOpen(false)} onStartGroupCall={startGroupCall} />}

      {friendToast && <div className="app-toast">{friendToast}</div>}

      {incomingGroupInvite && (
        <div className="app-invite-overlay">
          <div className="app-invite-card">
            <p>
              <strong>@{incomingGroupInvite.fromUsername}</strong> te chamou pra uma chamada em grupo.
            </p>
            <div className="app-invite-actions">
              <button onClick={acceptGroupInvite}>Entrar</button>
              <button className="muted" onClick={declineGroupInvite}>
                Recusar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
