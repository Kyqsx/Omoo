// src/config/redis.js
//
// Cria e exporta UM único cliente Redis, usado pela lógica de matchmaking
// (src/sockets/matchmaking.js) para gerenciar as filas de espera.
//
// Por que Redis e não o PostgreSQL para as filas?
// Porque a fila de matchmaking muda o tempo todo (gente entra e sai a cada
// segundo). Redis guarda tudo em memória, então é MUITO mais rápido para
// esse tipo de operação do que um banco relacional em disco.

const { createClient } = require('redis');

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => {
  console.error('[Redis] Erro de conexão:', err);
});

// A biblioteca "redis" v4 exige conexão explícita (é assíncrona).
// Exportamos uma função de inicialização que o server.js vai chamar.
async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log('[Redis] Conectado com sucesso.');
  }
  return redisClient;
}

module.exports = { redisClient, connectRedis };
