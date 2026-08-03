// src/lib/socket.js
//
// Cria UMA única instância do socket, reaproveitada pelo app inteiro.
// "autoConnect: false" porque só queremos abrir a conexão quando o
// usuário realmente entrar na tela (evita gastar conexão com quem só
// está de passagem pelo site).

import { io } from 'socket.io-client';
import { getToken } from './auth';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export const socket = io(BACKEND_URL, {
  autoConnect: false,
  // "auth" pode ser uma função — o socket.io-client chama ela de novo a
  // cada tentativa de conexão, então login/logout refletem automaticamente
  // na próxima vez que o socket conectar (sem precisar recriar o objeto).
  auth: (cb) => cb({ token: getToken() || null }),
});
