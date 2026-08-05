// src/admin/AdminLogin.jsx
//
// Login simples reaproveitando /api/auth/login. Depois de logar, o
// AdminApp confere se user.is_admin é true antes de liberar o dashboard.

import { useState } from 'react';
import { login } from '../lib/auth';

export default function AdminLogin({ onLoggedIn, deniedMessage }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      onLoggedIn(user);
    } catch (err) {
      setError(err.message || 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login-shell">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <h1>Omoo Admin</h1>
        <p className="admin-login-sub">Acesso restrito à equipe.</p>

        {deniedMessage && <div className="admin-error">{deniedMessage}</div>}
        {error && <div className="admin-error">{error}</div>}

        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Senha
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
