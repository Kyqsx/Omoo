// src/components/ChatPanel.jsx
//
// Chat de texto simples dentro da sala, usando o evento "chat_message"
// que o backend já repassa entre os dois sockets da mesma room.

import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import './chatpanel.css';

export default function ChatPanel({ roomId }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    function handleIncoming({ message }) {
      setMessages((prev) => [...prev, { text: message, mine: false }]);
    }
    socket.on('chat_message', handleIncoming);
    return () => socket.off('chat_message', handleIncoming);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function sendMessage(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    socket.emit('chat_message', { roomId, message: text });
    setMessages((prev) => [...prev, { text, mine: true }]);
    setDraft('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="chat-empty">Nenhuma mensagem ainda. Diga oi.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.mine ? 'mine' : 'theirs'}`}>
            {m.text}
          </div>
        ))}
      </div>
      <form className="chat-input-row" onSubmit={sendMessage}>
        <input
          type="text"
          placeholder="Digite uma mensagem"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit">Enviar</button>
      </form>
    </div>
  );
}
