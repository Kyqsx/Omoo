// authMiddleware.js
//
// Middlewares Express de proteção de rota:
//   - requireAuth  -> qualquer usuário logado
//   - requireAdmin -> só usuários com is_admin = true (dashboard admin)

const { verifyToken } = require('./authController');
const pool = require('./db');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Faça login para continuar.' });
  }

  req.userId = payload.userId;
  next();
}

/**
 * Roda depois de requireAuth (ou sozinho — ele valida o token de novo).
 * Consulta o banco a cada request pra garantir que o admin não foi
 * rebaixado desde que o token foi emitido (o JWT não carrega essa info,
 * de propósito, pra permissão de admin poder ser revogada na hora).
 */
async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Faça login para continuar.' });
    }

    const result = await pool.query('SELECT is_admin, is_banned FROM users WHERE id = $1', [payload.userId]);
    const user = result.rows[0];

    if (!user || user.is_banned) {
      return res.status(401).json({ error: 'Conta inválida.' });
    }
    if (!user.is_admin) {
      return res.status(403).json({ error: 'Acesso restrito a administradores.' });
    }

    req.userId = payload.userId;
    next();
  } catch (err) {
    console.error('[Auth] Erro ao verificar admin:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { requireAuth, requireAdmin };
