// src/components/ReportModal.jsx
//
// Permite denunciar o parceiro atual da chamada. Emite "report_user" pro
// backend, que salva na tabela "reports" pra moderação revisar depois.

import { useEffect, useState } from 'react';
import { socket } from '../lib/socket';
import './reportmodal.css';

const REASONS = [
  { value: 'nudez', label: 'Nudez / conteúdo sexual' },
  { value: 'assedio', label: 'Assédio ou comportamento abusivo' },
  { value: 'menor_de_idade', label: 'Parece ser menor de idade' },
  { value: 'spam', label: 'Spam ou propaganda' },
  { value: 'outro', label: 'Outro motivo' },
];

export default function ReportModal({ onClose }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    function handleSubmitted() {
      setStatus('sent');
    }
    function handleError({ message }) {
      setStatus('error');
      setErrorMsg(message || 'Não foi possível enviar a denúncia.');
    }
    socket.on('report_submitted', handleSubmitted);
    socket.on('report_error', handleError);
    return () => {
      socket.off('report_submitted', handleSubmitted);
      socket.off('report_error', handleError);
    };
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (!reason) return;
    setStatus('sending');
    socket.emit('report_user', { reason, details: details.trim() || undefined });
  }

  return (
    <div className="report-overlay" onClick={onClose}>
      <div className="report-modal" onClick={(e) => e.stopPropagation()}>
        <button className="report-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>

        {status === 'sent' ? (
          <div className="report-sent">
            <p>Denúncia enviada. Obrigado por ajudar a manter o Sinal seguro.</p>
            <button className="report-submit" onClick={onClose}>
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="report-form">
            <h3>Denunciar esta pessoa</h3>
            <div className="report-reasons">
              {REASONS.map((r) => (
                <label key={r.value} className="report-reason">
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
            <textarea
              placeholder="Detalhes (opcional)"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
            />
            {status === 'error' && <div className="report-error">{errorMsg}</div>}
            <button
              type="submit"
              className="report-submit"
              disabled={!reason || status === 'sending'}
            >
              {status === 'sending' ? 'Enviando...' : 'Enviar denúncia'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
