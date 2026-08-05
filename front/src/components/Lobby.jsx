// src/components/Lobby.jsx
//
// Primeira tela: usuário escolhe iniciar a busca. Se estiver logado E for
// Premium, aparecem os filtros (país). O status Premium/logado agora vem
// de verdade do backend (via token JWT), não mais de um campo digitado
// pelo próprio usuário.

import { useState } from 'react';
import { logout } from '../lib/auth';
import './lobby.css';

const COUNTRIES = [
  { value: '', label: 'Qualquer país' },
  { value: 'brasil', label: 'Brasil' },
  { value: 'portugal', label: 'Portugal' },
  { value: 'eua', label: 'Estados Unidos' },
];

const GENDERS = [
  { value: '', label: 'Qualquer gênero' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'feminino', label: 'Feminino' },
  { value: 'outro', label: 'Outro' },
];

export default function Lobby({ onStart, errorMsg, user, onOpenAuth, onOpenFriends, onSubscribe, subscribing }) {
  const [country, setCountry] = useState('');
  const [gender, setGender] = useState('');

  const isPremium = user?.is_premium === true;

  function handleStart() {
    if (isPremium) {
      onStart({ country, gender });
    } else {
      onStart({});
    }
  }

  function handleLogout() {
    logout();
    window.location.reload(); // forma simples de resetar todo o estado de sessão
  }

  return (
    <div className="lobby">
      <p className="lobby-eyebrow">chat de vídeo anônimo</p>
      <h1 className="lobby-title">
        Toda conversa
        <br />
        começa como um <span className="lobby-title-accent">sinal fraco</span>.
      </h1>
      <p className="lobby-sub">
        Sem cadastro, sem nome, sem histórico. Aperte o botão e a gente
        sintoniza você com a próxima pessoa disponível.
      </p>

      {errorMsg && <div className="lobby-error">{errorMsg}</div>}

      <button className="lobby-cta" onClick={handleStart}>
        Encontrar alguém
      </button>

      <div className="lobby-account">
        {!user && (
          <button className="lobby-account-link" onClick={onOpenAuth}>
            Entrar / criar conta (para filtros Premium)
          </button>
        )}

        {user && !isPremium && (
          <div className="lobby-premium-upsell">
            <p>Logado como {user.email}.</p>
            <button className="lobby-account-link" onClick={onOpenFriends}>
              Amigos
            </button>
            <button className="lobby-account-link" onClick={onSubscribe} disabled={subscribing}>
              {subscribing ? 'Abrindo checkout...' : 'Assinar Premium (filtrar por país)'}
            </button>
            <button className="lobby-account-link muted" onClick={handleLogout}>
              Sair da conta
            </button>
          </div>
        )}

        {user && isPremium && (
          <div className="lobby-premium-fields">
            <p className="lobby-premium-badge">✓ Conta Premium — {user.email}</p>
            <label>
              Filtrar por país
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Filtrar por gênero
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                {GENDERS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="lobby-account-link" onClick={onOpenFriends}>
              Amigos
            </button>
            <button className="lobby-account-link muted" onClick={handleLogout}>
              Sair da conta
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
