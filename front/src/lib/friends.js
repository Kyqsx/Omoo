// src/lib/friends.js
//
// Chamadas HTTP relacionadas ao sistema de amigos. Tudo exige estar
// logado (o token vai no header Authorization).

import { getToken } from './auth';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

async function authedFetch(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Algo deu errado.');
  return data;
}

export function listFriends() {
  return authedFetch('/api/friends');
}

export function searchUsers(username) {
  return authedFetch(`/api/friends/search?username=${encodeURIComponent(username)}`);
}

export function sendFriendRequest(username) {
  return authedFetch('/api/friends/request', { method: 'POST', body: JSON.stringify({ username }) });
}

export function respondFriendRequest(friendshipId, accept) {
  return authedFetch('/api/friends/respond', {
    method: 'POST',
    body: JSON.stringify({ friendshipId, accept }),
  });
}

export function removeFriend(friendshipId) {
  return authedFetch(`/api/friends/${friendshipId}`, { method: 'DELETE' });
}
