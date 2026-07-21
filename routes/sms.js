const router = require('express').Router();
const db     = require('../config/database');
const SMS    = require('../config/sms');
const { adminAuth } = require('../middleware/auth');

// ── POST /api/sms/send ── (admin)
router.post('/send', adminAuth, async (req, res) => {
  try {
    const { recipients, message, type } = req.body;
    // recipients: 'all_users' | 'all_partners' | 'debtors' | 'pending_orders' | [phone numbers]

    let phones = [];

    if (Array.isArray(recipients)) {
      phones = recipients;
    } else {
      let query = '';
      if (recipients === 'all_users')    query = 'SELECT phone FROM users WHERE status="active" AND role="user"';
      if (recipients === 'all_partners') query = 'SELECT phone FROM users WHERE status="active" AND role="partner"';
      if (recipients === 'debtors')      query = 'SELECT phone FROM users WHERE debt > 0';
      if (recipients === 'pending_orders') query = 'SELECT DISTINCT u.phone FROM orders o JOIN users u ON o.user_id=u.id WHERE o.status="pending_expert"';
      if (query) {
        const [rows] = await db.execute(query);
        phones = rows.map(r => r.phone);
      }
    }

    if (!phones.length) return res.status(400).json({ message: 'گیرنده‌ای یافت نشد' });

    let sent = 0, failed = 0;
    for (const phone of phones) {
      const result = await SMS.send(phone, message);
      if (result.success) sent++; else failed++;
    }

    res.json({ message: `پیامک ارسال شد`, sent, failed, total: phones.length });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/sms/status ── (admin) - checks if SMS service is configured
router.get('/status', adminAuth, async (req, res) => {
  const configured = !!(process.env.SMS_API_KEY && process.env.SMS_LINE);
  res.json({ configured, line: configured ? process.env.SMS_LINE : null });
});

// ── GET /api/sms/logs ── (admin)
router.get('/logs', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM sms_logs ORDER BY id DESC LIMIT 100');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
