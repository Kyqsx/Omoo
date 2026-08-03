// src/components/Searching.jsx
//
// Tela exibida enquanto o backend procura um par na fila do Redis.
// A animação (barras tipo equalizador + varredura) é o elemento de
// assinatura visual do app: em vez de um spinner genérico, remete à
// ideia de "sintonizar uma frequência".

import { useEffect, useState } from 'react';
import './searching.css';

const BAR_COUNT = 24;

export default function Searching({ onCancel }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="searching">
      <div className="searching-scanner" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }).map((_, i) => (
          <span
            key={i}
            className="searching-bar"
            style={{ animationDelay: `${(i % 8) * 0.08}s` }}
          />
        ))}
        <div className="searching-sweep" />
      </div>

      <p className="searching-status">
        Procurando um sinal<span className="searching-dots" />
      </p>
      <p className="searching-timer">{formatTime(elapsed)}</p>

      <button className="searching-cancel" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

function formatTime(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}
