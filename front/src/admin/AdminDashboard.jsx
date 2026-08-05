// src/admin/AdminDashboard.jsx
//
// Primeira versão do dashboard: visão geral (números), fila de denúncias
// pra moderar, e busca/gestão de usuários (banir/desbanir). Dá pra
// evoluir depois com gráficos, filtros por período, etc.

import { useEffect, useState } from 'react';
import { getStats, listReports, markReportReviewed, listUsers, setUserBanned } from './adminApi';
import { logout } from '../lib/auth';

function StatCard({ label, value }) {
  return (
    <div className="admin-stat-card">
      <span className="admin-stat-value">{value ?? '—'}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  );
}

export default function AdminDashboard({ adminUser, onLogout }) {
  const [tab, setTab] = useState('overview'); // 'overview' | 'reports' | 'users'
  const [stats, setStats] = useState(null);

  const [reportStatus, setReportStatus] = useState('pending');
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch((err) => console.error('[Admin] Erro ao buscar stats:', err));
  }, []);

  useEffect(() => {
    if (tab !== 'reports') return;
    setReportsLoading(true);
    listReports(reportStatus)
      .then((data) => setReports(data.reports))
      .catch((err) => console.error('[Admin] Erro ao listar denúncias:', err))
      .finally(() => setReportsLoading(false));
  }, [tab, reportStatus]);

  async function refreshUsers(search = userSearch) {
    setUsersLoading(true);
    try {
      const data = await listUsers(search);
      setUsers(data.users);
    } catch (err) {
      console.error('[Admin] Erro ao listar usuários:', err);
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'users') refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function handleReview(id) {
    try {
      await markReportReviewed(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('[Admin] Erro ao revisar denúncia:', err);
    }
  }

  async function handleToggleBan(u) {
    try {
      await setUserBanned(u.id, !u.is_banned);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_banned: !x.is_banned } : x)));
    } catch (err) {
      console.error('[Admin] Erro ao banir/desbanir:', err);
    }
  }

  function handleLogout() {
    logout();
    onLogout();
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">Omoo Admin</div>
        <nav>
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
            Visão geral
          </button>
          <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>
            Denúncias
          </button>
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
            Usuários
          </button>
        </nav>
        <div className="admin-sidebar-footer">
          <span>{adminUser?.email}</span>
          <button className="admin-logout" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      <main className="admin-main">
        {tab === 'overview' && (
          <section>
            <h1>Visão geral</h1>
            <div className="admin-stats-grid">
              <StatCard label="Usuários totais" value={stats?.totalUsers} />
              <StatCard label="Usuários Premium" value={stats?.premiumUsers} />
              <StatCard label="Novos em 7 dias" value={stats?.newUsersLast7Days} />
              <StatCard label="Denúncias totais" value={stats?.totalReports} />
              <StatCard label="Denúncias pendentes" value={stats?.pendingReports} />
            </div>
          </section>
        )}

        {tab === 'reports' && (
          <section>
            <div className="admin-section-header">
              <h1>Denúncias</h1>
              <div className="admin-tabs">
                <button className={reportStatus === 'pending' ? 'active' : ''} onClick={() => setReportStatus('pending')}>
                  Pendentes
                </button>
                <button className={reportStatus === 'reviewed' ? 'active' : ''} onClick={() => setReportStatus('reviewed')}>
                  Revisadas
                </button>
                <button className={reportStatus === 'all' ? 'active' : ''} onClick={() => setReportStatus('all')}>
                  Todas
                </button>
              </div>
            </div>

            {reportsLoading ? (
              <p className="admin-muted">Carregando...</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Motivo</th>
                    <th>Denunciado</th>
                    <th>Denunciante</th>
                    <th>Detalhes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.created_at).toLocaleString('pt-BR')}</td>
                      <td>{r.reason}</td>
                      <td>{r.reported_username ? `@${r.reported_username}` : r.reported_email || 'anônimo'}</td>
                      <td>{r.reporter_username ? `@${r.reporter_username}` : r.reporter_email || 'anônimo'}</td>
                      <td className="admin-table-details">{r.details || '—'}</td>
                      <td>
                        {!r.reviewed && (
                          <button className="admin-action" onClick={() => handleReview(r.id)}>
                            Marcar revisada
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {reports.length === 0 && (
                    <tr>
                      <td colSpan={6} className="admin-muted">
                        Nenhuma denúncia aqui.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === 'users' && (
          <section>
            <div className="admin-section-header">
              <h1>Usuários</h1>
              <form
                className="admin-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  refreshUsers();
                }}
              >
                <input
                  type="text"
                  placeholder="Buscar por email ou usuário"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
                <button type="submit">Buscar</button>
              </form>
            </div>

            {usersLoading ? (
              <p className="admin-muted">Carregando...</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>Email</th>
                    <th>Premium</th>
                    <th>Admin</th>
                    <th>Criado em</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username ? `@${u.username}` : '—'}</td>
                      <td>{u.email}</td>
                      <td>{u.is_premium ? 'Sim' : 'Não'}</td>
                      <td>{u.is_admin ? 'Sim' : 'Não'}</td>
                      <td>{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
                      <td>
                        <button
                          className={`admin-action ${u.is_banned ? 'danger-off' : 'danger'}`}
                          onClick={() => handleToggleBan(u)}
                        >
                          {u.is_banned ? 'Desbanir' : 'Banir'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="admin-muted">
                        Nenhum usuário encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
