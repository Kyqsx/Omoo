// src/admin/adminApi.js
//
// Chamadas HTTP do dashboard admin. Usa o mesmo token JWT do login normal
// (lib/auth.js) — um admin é só um usuário com is_admin = true. O backend
// (requireAdmin) é quem de fato garante a permissão a cada request.

import { getToken } from '../lib/auth';

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

export const getStats = () => authedFetch('/api/admin/stats');

export const listReports = (status = 'pending', page = 1) =>
  authedFetch(`/api/admin/reports?status=${status}&page=${page}`);

export const markReportReviewed = (id) => authedFetch(`/api/admin/reports/${id}/review`, { method: 'POST' });

export const listUsers = (search = '', page = 1) =>
  authedFetch(`/api/admin/users?search=${encodeURIComponent(search)}&page=${page}`);

export const setUserBanned = (id, banned) =>
  authedFetch(`/api/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ banned }) });
