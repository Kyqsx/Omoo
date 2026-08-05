// src/components/CallScreen.jsx
//
// Tela principal da chamada: vídeo remoto em destaque, vídeo local em
// miniatura (estilo picture-in-picture), controles de mic/câmera, botão
// de "próximo" (encerra e busca outro par) e o painel de chat.

import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMicrophone,
  faMicrophoneSlash,
  faVideo,
  faVideoSlash,
  faCameraRotate,
  faComment,
  faUserPlus,
  faFlag,
  faForward,
  faPhoneSlash,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
import { useWebRTC } from '../hooks/useWebRTC';
import { socket } from '../lib/socket';
import ChatPanel from './ChatPanel';
import ReportModal from './ReportModal';
import './callscreen.css';

export default function CallScreen({ roomId, initiator, isLoggedIn, onNext, onEnd }) {
  const { localStream, remoteStream, connectionState, iceConnectionState, switchCamera } = useWebRTC({
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
              <div className="call-connecting-row">
                <span className="call-connecting-pulse" />
                Conectando...
              </div>
              <span className="call-connecting-debug">
                {connectionState} / ice: {iceConnectionState}
              </span>
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
            title={micOn ? 'Desligar microfone' : 'Ligar microfone'}
          >
            <FontAwesomeIcon icon={micOn ? faMicrophone : faMicrophoneSlash} />
          </button>
          <button
            className={`call-btn ${!camOn ? 'off' : ''}`}
            onClick={toggleCam}
            aria-label={camOn ? 'Desligar câmera' : 'Ligar câmera'}
            title={camOn ? 'Desligar câmera' : 'Ligar câmera'}
          >
            <FontAwesomeIcon icon={camOn ? faVideo : faVideoSlash} />
          </button>
          {hasMultipleCameras && (
            <button className="call-btn" onClick={switchCamera} aria-label="Inverter câmera" title="Inverter câmera">
              <FontAwesomeIcon icon={faCameraRotate} />
            </button>
          )}
          <button className="call-btn" onClick={() => setChatOpen((v) => !v)} aria-label="Chat" title="Chat">
            <FontAwesomeIcon icon={faComment} />
          </button>
          {isLoggedIn && (
            <button
              className="call-btn"
              onClick={handleAddFriend}
              disabled={friendStatus === 'sent'}
              aria-label="Adicionar amigo"
              title={friendStatus === 'sent' ? 'Pedido enviado' : 'Adicionar amigo'}
            >
              <FontAwesomeIcon icon={friendStatus === 'sent' ? faCheck : faUserPlus} />
            </button>
          )}
          <button className="call-btn report" onClick={() => setReportOpen(true)} aria-label="Denunciar" title="Denunciar">
            <FontAwesomeIcon icon={faFlag} />
          </button>
          <button className="call-btn next" onClick={onNext} aria-label="Próximo" title="Próximo">
            <FontAwesomeIcon icon={faForward} />
          </button>
          <button className="call-btn end" onClick={onEnd} aria-label="Sair" title="Sair">
            <FontAwesomeIcon icon={faPhoneSlash} />
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
