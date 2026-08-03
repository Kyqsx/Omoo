// src/controllers/stripeController.js
//
// Contém a lógica de negócio das rotas de pagamento.
// Duas responsabilidades principais:
//   1) createCheckoutSession -> cria o link de pagamento (assinatura mensal)
//   2) handleStripeWebhook   -> escuta a confirmação de pagamento do Stripe
//      e atualiza o usuário como Premium no PostgreSQL.

const stripe = require('./stripe');
const pool = require('./db');

/**
 * Cria uma sessão de Checkout do Stripe para assinatura recorrente mensal.
 * Agora exige login (ver authMiddleware.requireAuth) — o userId vem do
 * token JWT, não mais de um campo que o próprio cliente enviava.
 *
 * Também resolve o problema de "que usuário é esse pagamento": criamos
 * (ou reaproveitamos) um Stripe Customer ligado ao nosso userId ANTES do
 * checkout, e salvamos o ID desse customer no nosso banco imediatamente.
 * Assim, quando o webhook chegar depois, o cruzamento já está pronto.
 */
async function createCheckoutSession(req, res) {
  try {
    const userId = req.userId; // vem do authMiddleware.requireAuth

    const userResult = await pool.query(
      'SELECT email, stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    const user = userResult.rows[0];

    let stripeCustomerId = user.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(userId) },
      });
      stripeCustomerId = customer.id;

      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [
        stripeCustomerId,
        userId,
      ]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', // assinatura recorrente (não pagamento único)
      payment_method_types: ['card'],
      customer: stripeCustomerId,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, // Price ID criado no Dashboard Stripe
          quantity: 1,
        },
      ],
      metadata: {
        userId: String(userId),
      },
      success_url: process.env.CHECKOUT_SUCCESS_URL,
      cancel_url: process.env.CHECKOUT_CANCEL_URL,
    });

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('[Stripe] Erro ao criar sessão de checkout:', err);
    return res.status(500).json({ error: 'Erro ao criar sessão de pagamento.' });
  }
}

/**
 * Webhook do Stripe. O Stripe chama esta rota automaticamente quando algo
 * acontece na sua conta (pagamento aprovado, falhou, assinatura cancelada...).
 *
 * IMPORTANTE: esta rota precisa receber o corpo da requisição "cru" (raw),
 * sem passar pelo express.json(), porque o Stripe valida a assinatura do
 * evento usando os bytes exatos do corpo. Isso é configurado no server.js.
 */
async function handleStripeWebhook(req, res) {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    // Verifica que o evento realmente veio do Stripe (e não de um atacante
    // forjando uma chamada para essa rota).
    event = stripe.webhooks.constructEvent(
      req.body, // corpo raw (Buffer), configurado no server.js
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[Stripe Webhook] Assinatura inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Tratamos apenas o evento que nos interessa: pagamento de fatura confirmado.
  if (event.type === 'invoice.payment_succeeded') {
    try {
      const invoice = event.data.object;
      const customerId = invoice.customer; // ID do cliente no Stripe

      // Tenta descobrir o userId. Em muitos fluxos, o customer_id do Stripe
      // já está salvo no nosso banco (associado no primeiro checkout).
      // Caso ainda não esteja, buscamos pelos metadados da sessão original
      // (ver observação no README sobre variações desse fluxo).
      const result = await pool.query(
        `UPDATE users
         SET is_premium = true,
             stripe_customer_id = $1
         WHERE stripe_customer_id = $1
         RETURNING id`,
        [customerId]
      );

      if (result.rowCount === 0) {
        console.warn(
          `[Stripe Webhook] Nenhum usuário encontrado com stripe_customer_id=${customerId}. ` +
          `Verifique se o customer_id foi salvo no momento do checkout.`
        );
      } else {
        console.log(`[Stripe Webhook] Usuário ${result.rows[0].id} agora é Premium.`);
      }
    } catch (err) {
      console.error('[Stripe Webhook] Erro ao atualizar usuário no banco:', err);
      // Retornamos 500 para o Stripe tentar reenviar o evento depois.
      return res.status(500).send('Erro interno ao processar webhook.');
    }
  }

  // Sempre responda 200 rapidamente para o Stripe saber que recebemos o evento.
  return res.status(200).json({ received: true });
}

module.exports = { createCheckoutSession, handleStripeWebhook };
