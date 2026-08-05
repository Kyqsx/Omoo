// friendRoutes.js
const express = require('express');
const { requireAuth } = require('./authMiddleware');
const {
  searchByUsername,
  sendRequest,
  respondRequest,
  listFriends,
  removeFriend,
} = require('./friendController');

const router = express.Router();

router.use(requireAuth); // toda rota de amigos exige login

router.get('/search', searchByUsername);
router.get('/', listFriends);
router.post('/request', sendRequest);
router.post('/respond', respondRequest);
router.delete('/:friendshipId', removeFriend);

module.exports = router;
