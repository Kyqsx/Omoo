-- Rode este script no seu banco PostgreSQL para criar a estrutura mínima
-- necessária. Exemplo: psql -U postgres -d omegle_db -f src/db/schema.sql

CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL PRIMARY KEY,
    email               VARCHAR(255) UNIQUE NOT NULL,
    stripe_customer_id  VARCHAR(255) UNIQUE,       -- ID do cliente no Stripe
    is_premium          BOOLEAN NOT NULL DEFAULT FALSE,
    premium_expires_at  TIMESTAMP,                 -- opcional: controle de expiração
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índice para localizar rapidamente o usuário pelo cliente Stripe
-- (usado no webhook de pagamento)
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users (stripe_customer_id);
