-- Rode este script no seu banco PostgreSQL para criar a estrutura mínima
-- necessária. Exemplo: psql -U postgres -d omegle_db -f schema.sql
-- (ou cole no SQL Editor do Supabase)

CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL PRIMARY KEY,
    email               VARCHAR(255) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,     -- senha com hash (bcrypt), nunca em texto puro
    stripe_customer_id  VARCHAR(255) UNIQUE,       -- ID do cliente no Stripe
    is_premium          BOOLEAN NOT NULL DEFAULT FALSE,
    premium_expires_at  TIMESTAMP,                 -- opcional: controle de expiração
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índice para localizar rapidamente o usuário pelo cliente Stripe
-- (usado no webhook de pagamento)
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users (stripe_customer_id);

-- Denúncias feitas por um usuário contra o parceiro de uma sala de chat.
-- reporter_user_id / reported_user_id ficam NULL quando o usuário envolvido
-- era Free (não logado) — nesse caso guardamos ao menos o socket_id, útil
-- para cruzar com logs do servidor se precisar investigar.
CREATE TABLE IF NOT EXISTS reports (
    id                  SERIAL PRIMARY KEY,
    room_id             VARCHAR(255) NOT NULL,
    reporter_user_id    INTEGER REFERENCES users(id),
    reporter_socket_id  VARCHAR(255) NOT NULL,
    reported_user_id    INTEGER REFERENCES users(id),
    reported_socket_id  VARCHAR(255) NOT NULL,
    reason              VARCHAR(100) NOT NULL,
    details             TEXT,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id ON reports (reported_user_id);

