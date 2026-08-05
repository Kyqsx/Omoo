// src/components/GroupCallScreen.jsx
//
// Tela da chamada em grupo (até 4 pessoas). Grid de vídeos + controles +
// painel pra convidar mais amigos (enquanto não bater o teto de 4).

import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMicrophone,
  faMicrophoneSlash,
  faVideo,
  faVideoSlash,
  faCameraRotate,
  faUserPlus,
  faPhoneSlash,
} from '@fortawesome/free-solid-svg-icons';
import { useGroupWebRTC } from '../hooks/useGroupWebRTC';
import { socket } from '../lib/socket';
import { listFriends } from '../lib/friends';
import './groupcallscreen.css';

const MAX_PARTICIPANTS = 4;

function VideoTile({ stream, label, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="group-tile">
      <video ref={ref} autoPlay playsInline muted={muted} />
      <span className="group-tile-label">{label}</span>
    </div>
  );
}

export default function GroupCallScreen({ roomId, onLeave }) {
  const { localStream, remoteStreams, participants, switchCamera } = useGroupWebRTC({
    roomId,
    active: true,
  });

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [friends, setFriends] = useState([]);
  const [invitedIds, setInvitedIds] = useState([]);

  const remoteCount = Object.keys(remoteStreams).length;
  const totalCount = remoteCount + 1; // +1 = eu

  function toggleMic() {
    localStream?.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMicOn((v) => !v);
  }

  function toggleCam() {
    localStream?.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setCamOn((v) => !v);
  }

  function handleLeave() {
    socket.emit('group_call_leave');
    onLeave();
  }

  async function openInvitePanel() {
    setInvitePanelOpen(true);
    try {
      const data = await listFriends();
      setFriends(data.friends);
    } catch (err) {
      console.error('[GroupCall] Erro ao carregar amigos:', err);
    }
  }

  function handleInvite(friendUserId) {
    socket.emit('group_call_invite', { targetUserId: friendUserId, roomId });
    setInvitedIds((prev) => [...prev, friendUserId]);
  }

  return (
    <div className="group-call-screen">
      <div className="group-call-header">
        <span>Chamada em grupo — {totalCount}/{MAX_PARTICIPANTS}</span>
        {totalCount < MAX_PARTICIPANTS && (
          <button className="group-call-invite-btn" onClick={openInvitePanel} title="Convidar amigo">
            <FontAwesomeIcon icon={faUserPlus} /> Convidar amigo
          </button>
        )}
      </div>

      <div className={`group-grid group-grid-${Math.min(totalCount, 4)}`}>
        <VideoTile stream={localStream} label="Você" muted />
        {Object.entries(remoteStreams).map(([socketId, stream]) => (
          <VideoTile key={socketId} stream={stream} label={participants[socketId]?.username || 'Participante'} />
        ))}
      </div>

      <div className="group-call-controls">
        <button
          className={`call-btn ${!micOn ? 'off' : ''}`}
          onClick={toggleMic}
          title={micOn ? 'Desligar microfone' : 'Ligar microfone'}
        >
          <FontAwesomeIcon icon={micOn ? faMicrophone : faMicrophoneSlash} />
        </button>
        <button
          className={`call-btn ${!camOn ? 'off' : ''}`}
          onClick={toggleCam}
          title={camOn ? 'Desligar câmera' : 'Ligar câmera'}
        >
          <FontAwesomeIcon icon={camOn ? faVideo : faVideoSlash} />
        </button>
        <button className="call-btn" onClick={switchCamera} title="Inverter câmera">
          <FontAwesomeIcon icon={faCameraRotate} />
        </button>
        <button className="call-btn end" onClick={handleLeave} title="Sair">
          <FontAwesomeIcon icon={faPhoneSlash} />
        </button>
      </div>

      {invitePanelOpen && (
        <div className="group-invite-overlay" onClick={() => setInvitePanelOpen(false)}>
          <div className="group-invite-panel" onClick={(e) => e.stopPropagation()}>
            <h3>Convidar amigo</h3>
            <ul>
              {friends.map((f) => (
                <li key={f.friendship_id}>
                  <span>@{f.username}</span>
                  <button disabled={invitedIds.includes(f.id)} onClick={() => handleInvite(f.id)}>
                    {invitedIds.includes(f.id) ? 'Convidado' : 'Convidar'}
                  </button>
                </li>
              ))}
              {friends.length === 0 && <p>Você ainda não tem amigos pra chamar.</p>}
            </ul>
            <button className="group-invite-close" onClick={() => setInvitePanelOpen(false)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
