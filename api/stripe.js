// src/config/stripe.js
//
// Instancia o SDK do Stripe uma única vez, usando a chave secreta do .env.

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = stripe;
