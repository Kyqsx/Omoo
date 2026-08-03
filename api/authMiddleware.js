// authMiddleware.js
//
// Middleware Express: bloqueia a rota se não vier um token válido no
// header "Authorization: Bearer <token>". Usado nas rotas que só fazem
// sentido para quem tem conta (ex: criar checkout do Stripe).

const { verifyToken } = require('./authController');

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

module.exports = { requireAuth };
