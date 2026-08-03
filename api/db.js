// src/config/db.js
//
// Responsável por criar UM único "Pool" de conexões com o PostgreSQL,
// reutilizado por toda a aplicação (controllers, sockets, etc).
// Isso evita abrir/fechar conexão a cada consulta.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // O Supabase (e a maioria dos Postgres gerenciados na nuvem) exige SSL
  // para conexões externas. "rejectUnauthorized: false" porque o Supabase
  // usa um certificado que o Node não reconhece automaticamente por padrão.
  // Em Postgres 100% local (sem SSL) isso é ignorado sem problema.
  ssl:
    process.env.DATABASE_SSL === 'false'
      ? false
      : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  // Erros inesperados em conexões ociosas do pool (ex: conexão caiu)
  console.error('[PostgreSQL] Erro inesperado no pool de conexões:', err);
});

module.exports = pool;
