// src/components/AuthModal.jsx
//
// Modal simples de login/registro. Usado pra desbloquear o fluxo Premium
// (filtros de pareamento) — usuários Free continuam usando o app sem
// nunca precisar abrir isso.

import { useState } from 'react';
import { login, register } from '../lib/auth';
import './authmodal.css';

const GENDERS = [
  { value: '', label: 'Prefiro não dizer' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'outro', label: 'Outro' },
];

export default function AuthModal({ onClose, onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [gender, setGender] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user =
        mode === 'login' ? await login(email, password) : await register(email, password, username, gender);
      onAuthenticated(user);
    } catch (err) {
      setError(err.message || 'Não foi possível continuar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="auth-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => setMode('login')}
          >
            Entrar
          </button>
          <button
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => setMode('register')}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
            />
          </label>

          {mode === 'register' && (
            <label>
              Nome de usuário
              <input
                type="text"
                required
                minLength={3}
                maxLength={20}
                pattern="[a-z0-9_]{3,20}"
                title="3 a 20 caracteres: letras minúsculas, números e _"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="usado pra amigos te adicionarem"
              />
            </label>
          )}

          <label>
            Senha
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
            />
          </label>

          {mode === 'register' && (
            <label>
              Gênero
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                {GENDERS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </div>
    </div>
  );
}
