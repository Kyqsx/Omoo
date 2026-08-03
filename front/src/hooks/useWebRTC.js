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

export function useWebRTC({ roomId, initiator, active }) {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');

  const pcRef = useRef(null);

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
      // 1) Pede câmera + microfone ao navegador
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
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

  return { localStream, remoteStream, connectionState };
}
