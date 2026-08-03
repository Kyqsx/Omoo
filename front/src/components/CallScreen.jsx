// src/components/CallScreen.jsx
//
// Tela principal da chamada: vídeo remoto em destaque, vídeo local em
// miniatura (estilo picture-in-picture), controles de mic/câmera, botão
// de "próximo" (encerra e busca outro par) e o painel de chat.

import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import ChatPanel from './ChatPanel';
import './callscreen.css';

export default function CallScreen({ roomId, initiator, onNext, onEnd }) {
  const { localStream, remoteStream, connectionState } = useWebRTC({
    roomId,
    initiator,
    active: true,
  });

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

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
          <button className="call-btn" onClick={() => setChatOpen((v) => !v)}>
            Chat
          </button>
          <button className="call-btn next" onClick={onNext}>
            Próximo
          </button>
          <button className="call-btn end" onClick={onEnd}>
            Sair
          </button>
        </div>
      </div>

      {chatOpen && (
        <div className="call-chat-column">
          <ChatPanel roomId={roomId} />
        </div>
      )}
    </div>
  );
}
