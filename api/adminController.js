// adminController.js
//
// Primeira fatia do dashboard admin: visão geral (números), fila de
// denúncias para moderação, e gestão básica de usuários (buscar, banir,
// promover a admin). Tudo protegido por requireAdmin (ver authMiddleware).

const pool = require('./db');

/**
 * GET /api/admin/stats
 */
async function getStats(req, res) {
  try {
    const [users, premium, reportsTotal, reportsPending, reports7d] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE is_premium = true'),
      pool.query('SELECT COUNT(*)::int AS count FROM reports'),
      pool.query('SELECT COUNT(*)::int AS count FROM reports WHERE reviewed = false'),
      pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`),
    ]);

    return res.status(200).json({
      totalUsers: users.rows[0].count,
      premiumUsers: premium.rows[0].count,
      totalReports: reportsTotal.rows[0].count,
      pendingReports: reportsPending.rows[0].count,
      newUsersLast7Days: reports7d.rows[0].count,
    });
  } catch (err) {
    console.error('[Admin] Erro ao buscar stats:', err);
    return res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
  }
}

/**
 * GET /api/admin/reports?status=pending|reviewed|all&page=1
 */
async function listReports(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = 25;
    const offset = (page - 1) * pageSize;
    const status = req.query.status || 'pending';

    let whereClause = '';
    if (status === 'pending') whereClause = 'WHERE r.reviewed = false';
    else if (status === 'reviewed') whereClause = 'WHERE r.reviewed = true';

    const result = await pool.query(
      `SELECT r.id, r.room_id, r.reason, r.details, r.reviewed, r.created_at,
              reporter.email AS reporter_email, reporter.username AS reporter_username,
              reported.email AS reported_email, reported.username AS reported_username,
              reported.id AS reported_user_id
       FROM reports r
       LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
       LEFT JOIN users reported ON reported.id = r.reported_user_id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    return res.status(200).json({ reports: result.rows, page, pageSize });
  } catch (err) {
    console.error('[Admin] Erro ao listar denúncias:', err);
    return res.status(500).json({ error: 'Erro ao listar denúncias.' });
  }
}

/**
 * POST /api/admin/reports/:id/review
 */
async function markReportReviewed(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query('UPDATE reports SET reviewed = true WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Denúncia não encontrada.' });
    return res.status(200).json({ reviewed: true });
  } catch (err) {
    console.error('[Admin] Erro ao marcar denúncia:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

/**
 * GET /api/admin/users?search=&page=1
 */
async function listUsers(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = 25;
    const offset = (page - 1) * pageSize;
    const search = (req.query.search || '').trim();

    const whereClause = search ? 'WHERE email ILIKE $3 OR username ILIKE $3' : '';
    const params = search ? [pageSize, offset, `%${search}%`] : [pageSize, offset];

    const result = await pool.query(
      `SELECT id, email, username, gender, is_premium, is_admin, is_banned, created_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    return res.status(200).json({ users: result.rows, page, pageSize });
  } catch (err) {
    console.error('[Admin] Erro ao listar usuários:', err);
    return res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
}

/**
 * POST /api/admin/users/:id/ban    body: { banned: boolean }
 */
async function setUserBanned(req, res) {
  try {
    const { id } = req.params;
    const { banned } = req.body;

    if (Number(id) === req.userId) {
      return res.status(400).json({ error: 'Você não pode banir a si mesmo.' });
    }

    const result = await pool.query('UPDATE users SET is_banned = $1 WHERE id = $2 RETURNING id, is_banned', [
      Boolean(banned),
      id,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('[Admin] Erro ao banir usuário:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { getStats, listReports, markReportReviewed, listUsers, setUserBanned };
