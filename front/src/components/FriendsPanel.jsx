// src/components/FriendsPanel.jsx
//
// Tela de amigos: lista de amigos (com botão "Chamar" pra iniciar uma
// chamada em grupo), pedidos recebidos/enviados, e busca por @username
// pra adicionar gente nova.

import { useEffect, useState } from 'react';
import {
  listFriends,
  searchUsers,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
} from '../lib/friends';
import './friendspanel.css';

export default function FriendsPanel({ onClose, onStartGroupCall }) {
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function refresh() {
    try {
      const data = await listFriends();
      setFriends(data.friends);
      setIncoming(data.incomingRequests);
      setOutgoing(data.outgoingRequests);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSearch(e) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      const data = await searchUsers(query.trim());
      setResults(data.users);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function handleAdd(username) {
    setError('');
    try {
      await sendFriendRequest(username);
      setResults((r) => r.filter((u) => u.username !== username));
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRespond(friendshipId, accept) {
    try {
      await respondFriendRequest(friendshipId, accept);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemove(friendshipId) {
    try {
      await removeFriend(friendshipId);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="friends-overlay" onClick={onClose}>
      <div className="friends-panel" onClick={(e) => e.stopPropagation()}>
        <div className="friends-header">
          <h2>Amigos</h2>
          <button className="friends-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        {error && <div className="friends-error">{error}</div>}

        <form className="friends-search" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Buscar por @usuário"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={searching}>
            Buscar
          </button>
        </form>

        {results.length > 0 && (
          <ul className="friends-list">
            {results.map((u) => (
              <li key={u.id}>
                <span>@{u.username}</span>
                <button onClick={() => handleAdd(u.username)}>Adicionar</button>
              </li>
            ))}
          </ul>
        )}

        {loading ? (
          <p className="friends-loading">Carregando...</p>
        ) : (
          <>
            {incoming.length > 0 && (
              <section>
                <h3>Pedidos recebidos</h3>
                <ul className="friends-list">
                  {incoming.map((r) => (
                    <li key={r.friendship_id}>
                      <span>@{r.username}</span>
                      <div className="friends-actions">
                        <button onClick={() => handleRespond(r.friendship_id, true)}>Aceitar</button>
                        <button className="muted" onClick={() => handleRespond(r.friendship_id, false)}>
                          Recusar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {outgoing.length > 0 && (
              <section>
                <h3>Pedidos enviados</h3>
                <ul className="friends-list">
                  {outgoing.map((r) => (
                    <li key={r.friendship_id}>
                      <span>@{r.username}</span>
                      <span className="friends-pending-tag">pendente</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3>Seus amigos ({friends.length})</h3>
              {friends.length === 0 && <p className="friends-empty">Você ainda não tem amigos por aqui.</p>}
              <ul className="friends-list">
                {friends.map((f) => (
                  <li key={f.friendship_id}>
                    <span>@{f.username}</span>
                    <div className="friends-actions">
                      <button onClick={() => onStartGroupCall(f)}>Chamar</button>
                      <button className="muted" onClick={() => handleRemove(f.friendship_id)}>
                        Remover
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
