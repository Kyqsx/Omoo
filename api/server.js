// server.js
//
// Ponto de entrada da aplicação. Aqui juntamos:
//   - Express (rotas HTTP normais, ex: criar checkout do Stripe)
//   - Socket.io (WebSocket, para matchmaking + sinalização WebRTC)
//   - Redis (fila de matchmaking)
//   - PostgreSQL (usado indiretamente via src/config/db.js)
//
// Rode com: node server.js  (ou "npm run dev" se tiver nodemon instalado)

require('dotenv').config(); // carrega as variáveis do arquivo .env

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { connectRedis } = require('./redis');
const stripeRoutes = require('./stripeRoutes');
const authRoutes = require('./authRoutes');
const { handleStripeWebhook } = require('./stripeController');
const { registerMatchmakingHandlers } = require('./matchmaking');

const app = express();
const server = http.createServer(app); // servidor HTTP "cru", necessário para o Socket.io "grudar" nele

// FRONTEND_URL vem do .env — em produção é a URL do seu app na Vercel
// (ex: https://meu-app.vercel.app). Aceita uma lista separada por vírgula
// para permitir também localhost durante o desenvolvimento.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim());

// Socket.io por cima do mesmo servidor HTTP
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

// ---------------------------------------------------------------------
// MIDDLEWARES GLOBAIS
// ---------------------------------------------------------------------
app.use(cors({ origin: allowedOrigins }));

// IMPORTANTE — ORDEM DAS ROTAS IMPORTA AQUI:
// A rota de webhook do Stripe precisa do corpo "raw" (bytes originais),
// não do JSON já convertido pelo express.json(). Por isso ela é registrada
// ANTES do express.json() global, com seu próprio middleware express.raw().
app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  handleStripeWebhook
);

// A partir daqui, todo o resto do app pode usar JSON normalmente.
app.use(express.json());

// ---------------------------------------------------------------------
// ROTAS HTTP
// ---------------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor de chat de video rodando.' });
});

// Rotas de pagamento (ex: POST /api/create-checkout-session)
app.use('/api', stripeRoutes);

// Rotas de autenticação (ex: POST /api/auth/register, /api/auth/login)
app.use('/api/auth', authRoutes);

// ---------------------------------------------------------------------
// INICIALIZAÇÃO
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Conecta ao Redis ANTES de aceitar conexões de socket, já que o
    // matchmaking depende dele.
    const redisClient = await connectRedis();

    // Registra todos os eventos de socket (find_match, webrtc_offer, etc.)
    registerMatchmakingHandlers(io, redisClient);

    server.listen(PORT, () => {
      console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Falha ao iniciar o servidor:', err);
    process.exit(1);
  }
}

start();
