// src/components/CallScreen.jsx
//
// Tela principal da chamada: vídeo remoto em destaque, vídeo local em
// miniatura (estilo picture-in-picture), controles de mic/câmera, botão
// de "próximo" (encerra e busca outro par) e o painel de chat.

import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { socket } from '../lib/socket';
import ChatPanel from './ChatPanel';
import ReportModal from './ReportModal';
import './callscreen.css';

export default function CallScreen({ roomId, initiator, isLoggedIn, onNext, onEnd }) {
  const { localStream, remoteStream, connectionState, switchCamera } = useWebRTC({
    roomId,
    initiator,
    active: true,
  });

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [friendStatus, setFriendStatus] = useState(null); // null | 'sent' | 'error'

  // Só mostra o botão de inverter câmera se o dispositivo tiver mais de
  // uma câmera (a maioria dos notebooks/desktops só tem uma).
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      })
      .catch(() => setHasMultipleCameras(false));
  }, []);

  // Reseta o status do botão "Adicionar amigo" a cada novo parceiro
  useEffect(() => {
    setFriendStatus(null);
  }, [roomId]);

  useEffect(() => {
    function onFriendSent() {
      setFriendStatus('sent');
    }
    function onFriendError() {
      setFriendStatus('error');
    }
    socket.on('friend_request_sent', onFriendSent);
    socket.on('friend_error', onFriendError);
    return () => {
      socket.off('friend_request_sent', onFriendSent);
      socket.off('friend_error', onFriendError);
    };
  }, []);

  function handleAddFriend() {
    socket.emit('add_friend_incall');
  }

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  function toggleMic() {
    localStream?.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMicOn((v) => !v);
  }

  function toggleCam() {
    localStream?.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCamOn((v) => !v);
  }

  const isConnecting = connectionState !== 'connected';

  return (
    <div className="call-screen">
      <div className="call-video-area">
        <div className="call-remote">
          {isConnecting && (
            <div className="call-connecting">
              <span className="call-connecting-pulse" />
              Conectando...
            </div>
          )}
          <video ref={remoteVideoRef} autoPlay playsInline className="call-remote-video" />
        </div>

        <video ref={localVideoRef} autoPlay playsInline muted className="call-local-video" />

        <div className="call-controls">
          <button
            className={`call-btn ${!micOn ? 'off' : ''}`}
            onClick={toggleMic}
            aria-label={micOn ? 'Desligar microfone' : 'Ligar microfone'}
          >
            {micOn ? 'Mic' : 'Mudo'}
          </button>
          <button
            className={`call-btn ${!camOn ? 'off' : ''}`}
            onClick={toggleCam}
            aria-label={camOn ? 'Desligar câmera' : 'Ligar câmera'}
          >
            {camOn ? 'Câmera' : 'Sem câmera'}
          </button>
          {hasMultipleCameras && (
            <button className="call-btn" onClick={switchCamera} aria-label="Inverter câmera">
              Inverter câmera
            </button>
          )}
          <button className="call-btn" onClick={() => setChatOpen((v) => !v)}>
            Chat
          </button>
          {isLoggedIn && (
            <button
              className="call-btn"
              onClick={handleAddFriend}
              disabled={friendStatus === 'sent'}
              aria-label="Adicionar amigo"
            >
              {friendStatus === 'sent' ? 'Pedido enviado' : 'Adicionar amigo'}
            </button>
          )}
          <button className="call-btn report" onClick={() => setReportOpen(true)}>
            Denunciar
          </button>
          <button className="call-btn next" onClick={onNext}>
            Próximo
          </button>
          <button className="call-btn end" onClick={onEnd}>
            Sair
          </button>
        </div>

        {friendStatus === 'error' && (
          <div className="call-friend-notice">Não foi possível enviar o pedido de amizade.</div>
        )}
      </div>

      {chatOpen && (
        <div className="call-chat-column">
          <ChatPanel roomId={roomId} />
        </div>
      )}

      {reportOpen && <ReportModal onClose={() => setReportOpen(false)} />}
    </div>
  );
}
