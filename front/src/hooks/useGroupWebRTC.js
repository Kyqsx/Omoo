// src/hooks/useGroupWebRTC.js
//
// Chamada em grupo com amigos (até 4 pessoas) usando WebRTC em MALHA:
// cada participante abre uma RTCPeerConnection direta com cada um dos
// outros (não existe um servidor central de vídeo). Com 4 pessoas isso
// dá no máximo 6 conexões — tranquilo pro navegador.
//
// Protocolo de entrada (evita duas ofertas simultâneas / "glare"):
//   - Quem ACABOU de entrar na sala é quem cria a "offer" para cada
//     participante que já estava lá (evento group_call_joined traz a
//     lista de quem já estava).
//   - Quem já estava só responde com "answer" quando recebe uma offer.
//   - Quando um terceiro entra depois, é ELE quem oferta pra todo mundo
//     (inclusive pra mim) — eu só escuto e respondo.

import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function useGroupWebRTC({ roomId, active }) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // { [socketId]: MediaStream }
  const [participants, setParticipants] = useState({}); // { [socketId]: { userId, username } }

  const pcMapRef = useRef(new Map()); // socketId -> RTCPeerConnection
  const localStreamRef = useRef(null);
  const facingModeRef = useRef('user');

  const closePeer = useCallback((socketId) => {
    const pc = pcMapRef.current.get(socketId);
    if (pc) {
      pc.close();
      pcMapRef.current.delete(socketId);
    }
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    setParticipants((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback(
    (targetSocketId) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });

      pc.ontrack = (event) => {
        setRemoteStreams((prev) => ({ ...prev, [targetSocketId]: event.streams[0] }));
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('group_webrtc_ice_candidate', { targetSocketId, candidate: event.candidate });
        }
      };

      pcMapRef.current.set(targetSocketId, pc);
      return pc;
    },
    []
  );

  const offerTo = useCallback(
    async (targetSocketId) => {
      const pc = pcMapRef.current.get(targetSocketId) || createPeerConnection(targetSocketId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('group_webrtc_offer', { targetSocketId, offer });
    },
    [createPeerConnection]
  );

  useEffect(() => {
    if (!active || !roomId) return;

    let cancelled = false;

    async function init() {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingModeRef.current },
        audio: true,
      });
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
    }

    async function handleJoined({ existingPeers }) {
      // Eu sou o recém-chegado: crio a offer pra cada um que já estava na sala.
      for (const socketId of existingPeers) {
        await offerTo(socketId);
      }
    }

    function handlePeerJoined({ socketId, userId, username }) {
      setParticipants((prev) => ({ ...prev, [socketId]: { userId, username } }));
    }

    function handlePeerLeft({ socketId }) {
      closePeer(socketId);
    }

    async function handleOffer({ offer, from }) {
      const pc = pcMapRef.current.get(from) || createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('group_webrtc_answer', { targetSocketId: from, answer });
    }

    async function handleAnswer({ answer, from }) {
      const pc = pcMapRef.current.get(from);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    async function handleIceCandidate({ candidate, from }) {
      const pc = pcMapRef.current.get(from);
      if (!pc || !candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[GroupWebRTC] Erro ao adicionar ICE candidate:', err);
      }
    }

    socket.on('group_call_joined', handleJoined);
    socket.on('group_call_peer_joined', handlePeerJoined);
    socket.on('group_call_peer_left', handlePeerLeft);
    socket.on('group_webrtc_offer', handleOffer);
    socket.on('group_webrtc_answer', handleAnswer);
    socket.on('group_webrtc_ice_candidate', handleIceCandidate);

    init().catch((err) => console.error('[GroupWebRTC] Erro ao iniciar câmera:', err));

    return () => {
      cancelled = true;
      socket.off('group_call_joined', handleJoined);
      socket.off('group_call_peer_joined', handlePeerJoined);
      socket.off('group_call_peer_left', handlePeerLeft);
      socket.off('group_webrtc_offer', handleOffer);
      socket.off('group_webrtc_answer', handleAnswer);
      socket.off('group_webrtc_ice_candidate', handleIceCandidate);

      pcMapRef.current.forEach((pc) => pc.close());
      pcMapRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStreams({});
      setParticipants({});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, roomId]);

  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current) return;
    const nextFacing = facingModeRef.current === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      // Troca o track em TODAS as conexões da malha de uma vez.
      pcMapRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
      });

      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldTrack) {
        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStreamRef.current.addTrack(newTrack);
      facingModeRef.current = nextFacing;
    } catch (err) {
      console.error('[GroupWebRTC] Erro ao inverter câmera:', err);
    }
  }, []);

  return { localStream, remoteStreams, participants, switchCamera };
}
