// src/admin/AdminApp.jsx
//
// Ponto de entrada da área /admin. Reaproveita o mesmo sistema de login
// (JWT) do app principal, mas só libera o dashboard se user.is_admin.

import { useEffect, useState } from 'react';
import { fetchCurrentUser } from '../lib/auth';
import AdminLogin from './AdminLogin';
import AdminDashboard from './AdminDashboard';
import './admin.css';

export default function AdminApp() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState(null);
  const [deniedMessage, setDeniedMessage] = useState('');

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (u && u.is_admin) setUser(u);
      setChecking(false);
    });
  }, []);

  function handleLoggedIn(loggedUser) {
    if (!loggedUser.is_admin) {
      setDeniedMessage('Essa conta não tem acesso ao painel administrativo.');
      return;
    }
    setDeniedMessage('');
    setUser(loggedUser);
  }

  if (checking) return <div className="admin-loading">Carregando...</div>;

  if (!user) {
    return <AdminLogin onLoggedIn={handleLoggedIn} deniedMessage={deniedMessage} />;
  }

  return <AdminDashboard adminUser={user} onLogout={() => setUser(null)} />;
}
