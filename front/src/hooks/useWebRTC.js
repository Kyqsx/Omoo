// src/hooks/useWebRTC.js
//
// Gerencia a conexão de vídeo PEER-TO-PEER (P2P) entre os dois usuários
// pareados. O servidor NÃO vê o vídeo/áudio — ele só ajuda os dois
// navegadores a "se apresentarem" (isso se chama "sinalização").
//
// Fluxo, em ordem:
//   1. O backend pareia dois usuários e manda "match_found" com um
//      roomId e quem é o "initiator" (quem inicia a chamada).
//   2. Cada navegador cria um RTCPeerConnection e pede acesso à
//      câmera/microfone (getUserMedia).
//   3. O "initiator" cria uma "offer" (proposta de conexão) e envia via
//      socket. O outro lado recebe, cria uma "answer" e devolve.
//   4. Os dois trocam "ICE candidates" (rotas de rede possíveis) até
//      acharem um caminho direto entre eles.
//   5. Quando a conexão fecha, o evento "ontrack" entrega o vídeo remoto.

import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../lib/socket';

// Servidores STUN públicos do Google — ajudam cada navegador a descobrir
// seu próprio endereço público (necessário para conectar através de NAT).
// Isso é suficiente para testes e para boa parte das redes domésticas.
// Em produção, é comum também configurar um servidor TURN (ex: Twilio,
// Metered, ou seu próprio coturn) para os casos em que a conexão direta
// não é possível (redes corporativas/4G restritivas). Veja o README.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Pede câmera+mic com facingMode como preferência ("ideal"), e se mesmo
 * assim falhar (dispositivo/navegador estranho), cai para vídeo genérico
 * em vez de deixar a chamada inteira quebrar.
 */
async function getUserMediaWithFacingMode(facingMode) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: true,
    });
  } catch (err) {
    console.warn('[WebRTC] facingMode ideal falhou, tentando vídeo genérico:', err);
    return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
}

export function useWebRTC({ roomId, initiator, active }) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  // 'user' = câmera frontal, 'environment' = câmera traseira (celular)
  const [facingMode, setFacingMode] = useState('user');

  const pcRef = useRef(null);
  const facingModeRef = useRef('user');

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream]);

  useEffect(() => {
    if (!active || !roomId) return;

    let cancelled = false;

    async function setup() {
      // 1) Pede câmera + microfone ao navegador.
      // IMPORTANTE: facingMode vai como "ideal", não como exigência rígida.
      // Muita webcam de notebook/desktop não declara suporte a
      // facingMode — se a gente exigisse ("exact"), o navegador rejeita
      // com OverconstrainedError, getUserMedia falha, e essa pessoa nunca
      // chega a criar a RTCPeerConnection nem enviar vídeo pro parceiro
      // (por isso o vídeo do outro lado simplesmente não aparecia).
      const stream = await getUserMediaWithFacingMode(facingModeRef.current);
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setLocalStream(stream);

      // 2) Cria a conexão peer-to-peer
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
      };

      // Sempre que o navegador descobre uma rota de rede possível,
      // manda pro outro lado via servidor (o servidor só repassa).
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc_ice_candidate', { roomId, candidate: event.candidate });
        }
      };

      // 3) Se este lado é o "iniciador", cria a offer primeiro.
      if (initiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', { roomId, offer });
      }
    }

    // --- Handlers dos eventos que chegam do outro navegador via servidor ---

    async function handleOffer({ offer }) {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc_answer', { roomId, answer });
    }

    async function handleAnswer({ answer }) {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    async function handleIceCandidate({ candidate }) {
      const pc = pcRef.current;
      if (!pc || !candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[WebRTC] Erro ao adicionar ICE candidate:', err);
      }
    }

    socket.on('webrtc_offer', handleOffer);
    socket.on('webrtc_answer', handleAnswer);
    socket.on('webrtc_ice_candidate', handleIceCandidate);

    setup().catch((err) => {
      console.error('[WebRTC] Erro ao configurar a chamada:', err);
    });

    return () => {
      cancelled = true;
      socket.off('webrtc_offer', handleOffer);
      socket.off('webrtc_answer', handleAnswer);
      socket.off('webrtc_ice_candidate', handleIceCandidate);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, roomId, initiator]);

  /**
   * Troca entre câmera frontal e traseira em tempo real, sem recriar a
   * conexão. Pede um novo stream de vídeo com o facingMode oposto e usa
   * replaceTrack() no sender do WebRTC — o outro lado nem percebe uma
   * "reconexão", só vê o vídeo trocar.
   */
  const switchCamera = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !localStream) return;

    const nextFacing = facingModeRef.current === 'user' ? 'environment' : 'user';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing } },
        audio: false,
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(newVideoTrack);

      const oldVideoTrack = localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        localStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      localStream.addTrack(newVideoTrack);

      facingModeRef.current = nextFacing;
      setFacingMode(nextFacing);
    } catch (err) {
      console.error('[WebRTC] Erro ao inverter câmera:', err);
    }
  }, [localStream]);

  return { localStream, remoteStream, connectionState, facingMode, switchCamera };
}
