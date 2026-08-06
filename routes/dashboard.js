const router = require('express').Router();
const db = require('../config/database');
const { adminAuth } = require('../middleware/auth');
const { buildDashboard } = require('../lib/dashboardService');

router.get('/', adminAuth, async (req, res) => {
  try {
    res.json(await buildDashboard(db));
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).json({ message:'خطا در دریافت اطلاعات داشبورد' });
  }
});

module.exports = router;