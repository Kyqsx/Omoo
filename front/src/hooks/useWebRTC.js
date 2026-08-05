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

// Servidores STUN + TURN. STUN sozinho só funciona quando os dois lados
// conseguem abrir uma rota direta entre si — em redes com NAT restritivo
// (4G, wifi corporativo/de faculdade, etc.) isso falha, e a conexão fica
// presa em "checking" e depois cai pra "failed". É pra isso que serve um
// servidor TURN: ele relay-eia o áudio/vídeo quando a conexão direta não
// rola. Aqui embaixo usamos o TURN público e gratuito do OpenRelay
// (Metered) — funciona sem cadastro, mas tem limite de banda mensal
// generoso o bastante pra testar/lançar, não pra escala grande. Pra
// produção de verdade, troque por um TURN dedicado (Metered pago, Twilio
// Network Traversal, Cloudflare Calls, ou seu próprio coturn) — veja o
// README.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:openrelay.metered.ca:80' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

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
  const [iceConnectionState, setIceConnectionState] = useState('new');
  // 'user' = câmera frontal, 'environment' = câmera traseira (celular)
  const [facingMode, setFacingMode] = useState('user');

  const pcRef = useRef(null);
  const facingModeRef = useRef('user');

  const log = useCallback(
    (...args) => console.log(`[WebRTC][room=${roomId}][initiator=${initiator}]`, ...args),
    [roomId, initiator]
  );

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState('new');
    setIceConnectionState('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream]);

  useEffect(() => {
    if (!active || !roomId) return;

    let cancelled = false;
    let localTracksReady = false;
    // Candidatos ICE que chegarem antes de já termos uma remote description
    // aplicada ficam guardados aqui e são aplicados depois, em ordem.
    const pendingCandidates = [];

    log('efeito iniciado — criando RTCPeerConnection');

    // Cria a conexão JÁ, de forma síncrona — antes de esperar a câmera.
    // Isso é essencial: se a criação do RTCPeerConnection dependesse do
    // await da câmera (como era antes), e o outro lado mandasse a oferta
    // enquanto essa pessoa ainda não tivesse aceitado a permissão de
    // câmera/microfone, a oferta chegaria sem ninguém pra recebê-la e
    // seria descartada — a chamada ficava presa em "Conectando..." pra
    // sempre. Agora a conexão (e os listeners) já existem no instante em
    // que este efeito roda; só as TRACKS locais é que chegam depois.
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    pc.ontrack = (event) => {
      log('ontrack — vídeo remoto recebido', event.streams[0]?.id);
      setRemoteStream(event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      log('connectionState mudou ->', pc.connectionState);
      setConnectionState(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      log('iceConnectionState mudou ->', pc.iceConnectionState);
      setIceConnectionState(pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        log('ICE falhou — provavelmente falta um servidor TURN pra essa combinação de redes (veja o README).');
      }
    };

    pc.onicegatheringstatechange = () => {
      log('iceGatheringState mudou ->', pc.iceGatheringState);
    };

    pc.onsignalingstatechange = () => {
      log('signalingState mudou ->', pc.signalingState);
    };

    // Sempre que o navegador descobre uma rota de rede possível,
    // manda pro outro lado via servidor (o servidor só repassa).
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        log('candidato ICE local encontrado, enviando ->', event.candidate.type, event.candidate.protocol);
        socket.emit('webrtc_ice_candidate', { roomId, candidate: event.candidate });
      } else {
        log('coleta de candidatos ICE terminou (candidato nulo)');
      }
    };

    async function setup() {
      log('pedindo câmera/microfone...');
      // Pede câmera + microfone ao navegador. facingMode vai como "ideal"
      // (preferência), não como exigência rígida — muita webcam de
      // notebook/desktop não declara suporte a facingMode, e exigir isso
      // faria o getUserMedia falhar por completo nela.
      const stream = await getUserMediaWithFacingMode(facingModeRef.current);
      log(
        'câmera/microfone concedidos — tracks:',
        stream.getTracks().map((t) => `${t.kind}:${t.readyState}`)
      );
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      setLocalStream(stream);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      localTracksReady = true;

      // Só cria a offer DEPOIS de já ter adicionado as tracks locais —
      // assim a offer já sai anunciando áudio+vídeo, sem precisar de
      // uma renegociação depois.
      if (initiator) {
        log('sou o iniciador — criando offer');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        log('offer criada e enviada');
        socket.emit('webrtc_offer', { roomId, offer });
      }
    }

    // --- Handlers dos eventos que chegam do outro navegador via servidor ---

    async function flushPendingCandidates() {
      log(`aplicando ${pendingCandidates.length} candidato(s) ICE pendente(s)`);
      while (pendingCandidates.length > 0) {
        const candidate = pendingCandidates.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('[WebRTC] Erro ao aplicar ICE candidate pendente:', err);
        }
      }
    }

    async function handleOffer({ offer }) {
      log('offer recebida do parceiro');
      // Espera as tracks locais estarem prontas antes de responder, pra
      // garantir que a answer já saia com nosso áudio/vídeo incluído.
      while (!localTracksReady && !cancelled) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (cancelled) return;

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      log('answer criada e enviada');
      socket.emit('webrtc_answer', { roomId, answer });
    }

    async function handleAnswer({ answer }) {
      log('answer recebida do parceiro');
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingCandidates();
    }

    async function handleIceCandidate({ candidate }) {
      if (!candidate) return;
      // Se a remote description ainda não foi aplicada, o candidato não
      // pode ser adicionado ainda — guardamos e aplicamos depois.
      if (!pc.remoteDescription) {
        log('candidato ICE remoto chegou cedo demais, guardando na fila');
        pendingCandidates.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        log('candidato ICE remoto aplicado ->', candidate.type, candidate.protocol);
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
      log('efeito desmontado — limpando conexão');
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

  return { localStream, remoteStream, connectionState, iceConnectionState, facingMode, switchCamera };
}
