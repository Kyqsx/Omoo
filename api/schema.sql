-- Rode este script no seu banco PostgreSQL para criar a estrutura mínima
-- necessária. Exemplo: psql -U postgres -d omegle_db -f schema.sql
-- (ou cole no SQL Editor do Supabase)

CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL PRIMARY KEY,
    email               VARCHAR(255) UNIQUE NOT NULL,
    username            VARCHAR(30) UNIQUE,        -- usado pra adicionar amigos (sem expor o email)
    password_hash       VARCHAR(255) NOT NULL,     -- senha com hash (bcrypt), nunca em texto puro
    gender              VARCHAR(20),               -- 'masculino' | 'feminino' | 'outro' (auto-declarado)
    stripe_customer_id  VARCHAR(255) UNIQUE,       -- ID do cliente no Stripe
    is_premium          BOOLEAN NOT NULL DEFAULT FALSE,
    premium_expires_at  TIMESTAMP,                 -- opcional: controle de expiração
    is_admin            BOOLEAN NOT NULL DEFAULT FALSE,
    is_banned           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índice para localizar rapidamente o usuário pelo cliente Stripe
-- (usado no webhook de pagamento)
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

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
    reviewed            BOOLEAN NOT NULL DEFAULT FALSE, -- marcado pelo admin ao analisar
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id ON reports (reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_reviewed ON reports (reviewed);

-- Amizades. Guardamos como um pedido (requester -> addressee) com status.
-- Quando aceito, os dois lados enxergam a amizade consultando a tabela nos
-- dois sentidos (requester_id = eu OU addressee_id = eu, status = accepted).
CREATE TABLE IF NOT EXISTS friendships (
    id             SERIAL PRIMARY KEY,
    requester_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | accepted | declined | blocked
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id, status);
