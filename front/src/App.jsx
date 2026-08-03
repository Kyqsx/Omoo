// src/App.jsx
//
// Controla em qual "tela" o usuário está: lobby -> searching -> call.
// Também gerencia a sessão (usuário logado ou não) e o checkout Premium.

import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './lib/socket';
import { fetchCurrentUser, getToken } from './lib/auth';
import Lobby from './components/Lobby';
import Searching from './components/Searching';
import CallScreen from './components/CallScreen';
import AuthModal from './components/AuthModal';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export default function App() {
  const [screen, setScreen] = useState('lobby'); // 'lobby' | 'searching' | 'call'
  const [match, setMatch] = useState(null); // { roomId, peerId, initiator }
  const [errorMsg, setErrorMsg] = useState('');

  const [user, setUser] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // Guarda os últimos filtros usados, para o botão "Próximo" repetir a
  // mesma busca sem o usuário precisar reconfigurar tudo de novo.
  const lastFiltersRef = useRef({});

  // Ao abrir o app, tenta recuperar a sessão a partir do token salvo.
  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (u) setUser(u);
    });
  }, []);

  const startSearch = useCallback((filters = {}) => {
    lastFiltersRef.current = filters;
    setErrorMsg('');
    setMatch(null);
    setScreen('searching');

    if (!socket.connected) socket.connect();
    socket.emit('find_match', { filters });
  }, []);

  useEffect(() => {
    function onMatchFound(data) {
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

    socket.on('match_found', onMatchFound);
    socket.on('match_error', onMatchError);
    socket.on('peer_left', onPeerLeft);

    return () => {
      socket.off('match_found', onMatchFound);
      socket.off('match_error', onMatchError);
      socket.off('peer_left', onPeerLeft);
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
    socket.disconnect();
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
          onNext={nextMatch}
          onEnd={endCall}
        />
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
    </div>
  );
}
