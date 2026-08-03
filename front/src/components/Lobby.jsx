// src/components/Lobby.jsx
//
// Primeira tela: usuário escolhe iniciar a busca. Se marcar "Sou Premium",
// aparecem os filtros (país). Isso é só uma simulação de UI — em produção,
// o status Premium real deve vir de autenticação (login), não de um
// checkbox que o próprio usuário marca! Deixei um campo de "ID de usuário"
// aqui apenas para você TESTAR o fluxo Premium do backend sem já ter
// construído login. Veja o comentário mais abaixo.

import { useState } from 'react';
import './lobby.css';

const COUNTRIES = [
  { value: 'brasil', label: 'Brasil' },
  { value: 'portugal', label: 'Portugal' },
  { value: 'eua', label: 'Estados Unidos' },
];

export default function Lobby({ onStart, errorMsg }) {
  const [isPremiumTest, setIsPremiumTest] = useState(false);
  const [userId, setUserId] = useState('');
  const [country, setCountry] = useState(COUNTRIES[0].value);

  function handleStart() {
    if (isPremiumTest) {
      onStart({ country }, userId || undefined);
    } else {
      onStart({});
    }
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

      <div className="lobby-premium">
        <label className="lobby-premium-toggle">
          <input
            type="checkbox"
            checked={isPremiumTest}
            onChange={(e) => setIsPremiumTest(e.target.checked)}
          />
          Testar como usuário Premium (dev)
        </label>

        {isPremiumTest && (
          <div className="lobby-premium-fields">
            <label>
              ID do usuário no banco (marcado como is_premium = true)
              <input
                type="text"
                placeholder="ex: 1"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </label>
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
          </div>
        )}
      </div>
    </div>
  );
}
