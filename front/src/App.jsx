// src/App.jsx
//
// Controla em qual "tela" o usuário está: lobby -> searching -> call.
// Também escuta os eventos globais do socket (match_found, peer_left,
// match_error) que fazem o app transitar entre essas telas.

import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './lib/socket';
import Lobby from './components/Lobby';
import Searching from './components/Searching';
import CallScreen from './components/CallScreen';

export default function App() {
  const [screen, setScreen] = useState('lobby'); // 'lobby' | 'searching' | 'call'
  const [match, setMatch] = useState(null); // { roomId, peerId, initiator }
  const [errorMsg, setErrorMsg] = useState('');

  // Guarda os últimos filtros usados, para o botão "Próximo" repetir a
  // mesma busca (ex: continuar filtrando por país) sem o usuário precisar
  // reconfigurar tudo de novo.
  const lastSearchRef = useRef({ filters: {}, userId: undefined });

  const startSearch = useCallback((filters = {}, userId = undefined) => {
    lastSearchRef.current = { filters, userId };
    setErrorMsg('');
    setMatch(null);
    setScreen('searching');

    if (!socket.connected) socket.connect();
    socket.emit('find_match', { filters, userId });
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

    // O outro lado saiu da chamada (fechou aba, clicou em sair, etc).
    // Voltamos automaticamente para a busca por um novo par.
    function onPeerLeft() {
      setMatch(null);
      startSearch(lastSearchRef.current.filters, lastSearchRef.current.userId);
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
    startSearch(lastSearchRef.current.filters, lastSearchRef.current.userId);
  }, [startSearch]);

  const endCall = useCallback(() => {
    socket.emit('leave_room');
    setMatch(null);
    setScreen('lobby');
    socket.disconnect();
  }, []);

  return (
    <div className="app-shell">
      <div className="brand">
        <span className="brand-dot" />
        Sinal
      </div>

      {screen === 'lobby' && <Lobby onStart={startSearch} errorMsg={errorMsg} />}
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
    </div>
  );
}
