// src/lib/auth.js
//
// Chama as rotas de autenticação do backend e guarda o token no
// localStorage do navegador (só no navegador do próprio usuário — isso
// não é um Artifact do Claude, é um app de verdade, então localStorage
// funciona normalmente aqui).

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
const STORAGE_KEY = 'sinal_auth_token';

export function getToken() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setToken(token) {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
}

async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Algo deu errado.');
  }
  return data;
}

export async function register(email, password) {
  const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJsonResponse(response);
  setToken(data.token);
  return data.user;
}

export async function login(email, password) {
  const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJsonResponse(response);
  setToken(data.token);
  return data.user;
}

/**
 * Recarrega os dados do usuário logado a partir do token salvo.
 * Útil ao abrir o app de novo (F5) sem perder a sessão.
 * Retorna null se não houver token ou se ele estiver expirado/inválido.
 */
export async function fetchCurrentUser() {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      clearToken();
      return null;
    }
    const data = await response.json();
    return data.user;
  } catch (err) {
    console.error('[Auth] Erro ao buscar usuário atual:', err);
    return null;
  }
}

export function logout() {
  clearToken();
}
