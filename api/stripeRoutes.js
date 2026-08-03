// src/routes/stripeRoutes.js
//
// Define os caminhos HTTP (endpoints) relacionados a pagamento.
// A lógica de verdade fica no controller; aqui só ligamos rota -> função.

const express = require('express');
const { createCheckoutSession } = require('./stripeController');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

// POST /api/create-checkout-session
// Chamado pelo frontend quando o usuário clica em "Assinar Premium".
// Exige login: precisa mandar "Authorization: Bearer <token>".
router.post('/create-checkout-session', requireAuth, createCheckoutSession);

// Observação: a rota de webhook (/webhook/stripe) é registrada separadamente
// no server.js, e NÃO aqui, porque ela precisa de um middleware especial
// (express.raw) aplicado antes do express.json() global. Veja server.js.

module.exports = router;
