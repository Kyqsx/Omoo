// friendController.js
//
// CRUD de amizades via HTTP. Adicionar amigo é feito pelo @username
// (nunca pelo email, que fica privado). O convite ao vivo durante uma
// chamada (botão "Adicionar amigo" na CallScreen) é tratado à parte, via
// socket, em social.js — mas usa as mesmas funções de banco daqui.

const pool = require('./db');

/**
 * GET /api/friends/search?username=fulano
 * Usado pelo campo de busca em "Adicionar amigo".
 */
async function searchByUsername(req, res) {
  try {
    const { username } = req.query;
    if (!username || username.trim().length < 2) {
      return res.status(400).json({ error: 'Digite ao menos 2 caracteres.' });
    }

    const result = await pool.query(
      `SELECT id, username FROM users
       WHERE username ILIKE $1 AND id <> $2
       ORDER BY username ASC LIMIT 10`,
      [`%${username.trim().toLowerCase()}%`, req.userId]
    );

    return res.status(200).json({ users: result.rows });
  } catch (err) {
    console.error('[Friends] Erro ao buscar usuário:', err);
    return res.status(500).json({ error: 'Erro ao buscar usuário.' });
  }
}

/**
 * POST /api/friends/request  body: { username }
 */
async function sendRequest(req, res) {
  try {
    const requesterId = req.userId;
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Informe o nome de usuário.' });
    }

    const targetResult = await pool.query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (targetResult.rowCount === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    const addresseeId = targetResult.rows[0].id;

    if (addresseeId === requesterId) {
      return res.status(400).json({ error: 'Você não pode adicionar a si mesmo.' });
    }

    // Já existe pedido/amizade em algum dos dois sentidos?
    const existing = await pool.query(
      `SELECT id, status, requester_id FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)`,
      [requesterId, addresseeId]
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      if (row.status === 'accepted') {
        return res.status(409).json({ error: 'Vocês já são amigos.' });
      }
      if (row.status === 'pending') {
        return res.status(409).json({ error: 'Já existe um pedido pendente.' });
      }
      // status 'declined' anterior — permite tentar de novo, atualizando a linha
      await pool.query(
        `UPDATE friendships SET status = 'pending', requester_id = $1, addressee_id = $2, updated_at = NOW()
         WHERE id = $3`,
        [requesterId, addresseeId, row.id]
      );
      return res.status(201).json({ addresseeId });
    }

    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`,
      [requesterId, addresseeId]
    );

    return res.status(201).json({ addresseeId });
  } catch (err) {
    console.error('[Friends] Erro ao enviar pedido:', err);
    return res.status(500).json({ error: 'Erro ao enviar pedido de amizade.' });
  }
}

/**
 * POST /api/friends/respond  body: { friendshipId, accept: boolean }
 */
async function respondRequest(req, res) {
  try {
    const userId = req.userId;
    const { friendshipId, accept } = req.body;

    const result = await pool.query(
      `SELECT id, requester_id, addressee_id, status FROM friendships WHERE id = $1`,
      [friendshipId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    const friendship = result.rows[0];

    if (friendship.addressee_id !== userId) {
      return res.status(403).json({ error: 'Esse pedido não é seu.' });
    }
    if (friendship.status !== 'pending') {
      return res.status(409).json({ error: 'Esse pedido já foi respondido.' });
    }

    const newStatus = accept ? 'accepted' : 'declined';
    await pool.query(`UPDATE friendships SET status = $1, updated_at = NOW() WHERE id = $2`, [
      newStatus,
      friendshipId,
    ]);

    return res.status(200).json({ status: newStatus, requesterId: friendship.requester_id });
  } catch (err) {
    console.error('[Friends] Erro ao responder pedido:', err);
    return res.status(500).json({ error: 'Erro ao responder pedido.' });
  }
}

/**
 * GET /api/friends
 * Lista amigos (status accepted) + pedidos pendentes recebidos e enviados.
 */
async function listFriends(req, res) {
  try {
    const userId = req.userId;

    const friends = await pool.query(
      `SELECT u.id, u.username,
              f.id AS friendship_id
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
       ORDER BY u.username ASC`,
      [userId]
    );

    const incoming = await pool.query(
      `SELECT f.id AS friendship_id, u.id AS user_id, u.username
       FROM friendships f JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId]
    );

    const outgoing = await pool.query(
      `SELECT f.id AS friendship_id, u.id AS user_id, u.username
       FROM friendships f JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId]
    );

    return res.status(200).json({
      friends: friends.rows,
      incomingRequests: incoming.rows,
      outgoingRequests: outgoing.rows,
    });
  } catch (err) {
    console.error('[Friends] Erro ao listar amigos:', err);
    return res.status(500).json({ error: 'Erro ao listar amigos.' });
  }
}

/**
 * DELETE /api/friends/:friendshipId
 * Remove uma amizade (ou cancela um pedido pendente enviado por mim).
 */
async function removeFriend(req, res) {
  try {
    const userId = req.userId;
    const { friendshipId } = req.params;

    const result = await pool.query(
      `DELETE FROM friendships WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)`,
      [friendshipId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Amizade não encontrada.' });
    }
    return res.status(200).json({ removed: true });
  } catch (err) {
    console.error('[Friends] Erro ao remover amigo:', err);
    return res.status(500).json({ error: 'Erro ao remover amigo.' });
  }
}

/**
 * Usado por social.js (convite de amigo dentro da chamada) — mesma regra
 * de negócio de sendRequest, mas recebendo IDs (já sabemos o peerUserId).
 */
async function createFriendRequestByIds(requesterId, addresseeId) {
  const existing = await pool.query(
    `SELECT id, status FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [requesterId, addresseeId]
  );
  if (existing.rowCount > 0) {
    return { alreadyExists: true, status: existing.rows[0].status };
  }
  const result = await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
    [requesterId, addresseeId]
  );
  return { alreadyExists: false, friendshipId: result.rows[0].id };
}

module.exports = {
  searchByUsername,
  sendRequest,
  respondRequest,
  listFriends,
  removeFriend,
  createFriendRequestByIds,
};
