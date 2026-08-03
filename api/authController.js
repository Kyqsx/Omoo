// authController.js
//
// Registro e login de usuários. Sem isso, não dá pra saber com segurança
// quem é Premium — antes o frontend simplesmente "dizia" o userId, o que
// qualquer pessoa poderia forjar. Agora o servidor emite um token (JWT)
// depois do login, e esse token é a prova de identidade em todo o resto
// do sistema (matchmaking, checkout, etc).

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRATION = '30d'; // usuário fica "logado" por 30 dias

function assertJwtSecretConfigured() {
  if (!JWT_SECRET) {
    throw new Error(
      'JWT_SECRET não configurado no .env / nas variáveis do Railway. ' +
      'Gere um valor aleatório longo e configure antes de usar login.'
    );
  }
}

/**
 * POST /api/auth/register
 * body: { email, password }
 */
async function register(req, res) {
  try {
    assertJwtSecretConfigured();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Já existe uma conta com esse email.' });
    }

    // Nunca guardamos a senha em texto puro — só o hash.
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, is_premium`,
      [email.toLowerCase(), passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });

    return res.status(201).json({ token, user });
  } catch (err) {
    console.error('[Auth] Erro ao registrar:', err);
    return res.status(500).json({ error: 'Erro ao criar a conta.' });
  }
}

/**
 * POST /api/auth/login
 * body: { email, password }
 */
async function login(req, res) {
  try {
    assertJwtSecretConfigured();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash, is_premium FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    // Mensagem genérica de propósito: não revelamos se foi o email ou a
    // senha que erraram, pra dificultar tentativas de descobrir emails
    // cadastrados (enumeração de contas).
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email, is_premium: user.is_premium },
    });
  } catch (err) {
    console.error('[Auth] Erro ao logar:', err);
    return res.status(500).json({ error: 'Erro ao entrar na conta.' });
  }
}

/**
 * Verifica um token JWT e devolve o payload (ou null se inválido/expirado).
 * Usada tanto por uma rota HTTP protegida quanto pela conexão de socket.
 */
function verifyToken(token) {
  if (!token || !JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * GET /api/auth/me
 * Rota simples pra o frontend confirmar quem é o usuário logado a partir
 * do token (ex: ao recarregar a página).
 */
async function me(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, is_premium FROM users WHERE id = $1',
      [payload.userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    return res.status(200).json({ user: result.rows[0] });
  } catch (err) {
    console.error('[Auth] Erro ao buscar usuário:', err);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}

module.exports = { register, login, me, verifyToken };
