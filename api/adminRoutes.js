// adminRoutes.js
const express = require('express');
const { requireAdmin } = require('./authMiddleware');
const {
  getStats,
  listReports,
  markReportReviewed,
  listUsers,
  setUserBanned,
} = require('./adminController');

const router = express.Router();

router.use(requireAdmin); // toda rota /api/admin exige is_admin = true

router.get('/stats', getStats);
router.get('/reports', listReports);
router.post('/reports/:id/review', markReportReviewed);
router.get('/users', listUsers);
router.post('/users/:id/ban', setUserBanned);

module.exports = router;
