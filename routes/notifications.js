const router = require('express').Router();
const db     = require('../config/database');
const { adminAuth } = require('../middleware/auth');

// ── GET /api/notifications ── (admin) - list recent notifications
router.get('/', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'
    );
    const unreadCount = rows.filter(r => !r.is_read).length;
    res.json({ notifications: rows, unreadCount });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/notifications/read-all ── (admin) - mark all as read
router.patch('/read-all', adminAuth, async (req, res) => {
  try {
    await db.execute('UPDATE notifications SET is_read=1 WHERE is_read=0');
    res.json({ message: 'همه اعلان‌ها خوانده شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/notifications/:id/read ── (admin) - mark one as read
router.patch('/:id/read', adminAuth, async (req, res) => {
  try {
    await db.execute('UPDATE notifications SET is_read=1 WHERE id=?', [req.params.id]);
    res.json({ message: 'اعلان خوانده شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/notifications ── (admin) - clear all
router.delete('/', adminAuth, async (req, res) => {
  try {
    await db.execute('DELETE FROM notifications WHERE is_read=1');
    res.json({ message: 'اعلان‌های خوانده‌شده پاک شدند' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
