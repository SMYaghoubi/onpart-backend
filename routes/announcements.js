const router = require('express').Router();
const db     = require('../config/database');
const { adminAuth } = require('../middleware/auth');

// ── GET /api/announcements ── (shop users - active only)
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, title, body, type, created_at
       FROM announcements
       WHERE is_active = 1
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ announcements: rows });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/announcements/admin ── (admin panel - all)
router.get('/admin', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM announcements ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/announcements ──
router.post('/', adminAuth, async (req, res) => {
  try {
    const { title, body, type = 'info', expires_at } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ message: 'عنوان و متن الزامی است' });
    }
    const [result] = await db.execute(
      'INSERT INTO announcements (title, body, type, expires_at, created_by) VALUES (?,?,?,?,?)',
      [title.trim(), body.trim(), type, expires_at || null, req.user.id]
    );
    res.status(201).json({ id: result.insertId, message: 'اعلان ایجاد شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PUT /api/announcements/:id ──
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { title, body, type, expires_at } = req.body;
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ message: 'عنوان و متن الزامی است' });
    }
    await db.execute(
      'UPDATE announcements SET title=?, body=?, type=?, expires_at=? WHERE id=?',
      [title.trim(), body.trim(), type || 'info', expires_at || null, req.params.id]
    );
    res.json({ message: 'اعلان ویرایش شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/announcements/:id/toggle ──
router.patch('/:id/toggle', adminAuth, async (req, res) => {
  try {
    await db.execute(
      'UPDATE announcements SET is_active = NOT is_active WHERE id=?',
      [req.params.id]
    );
    res.json({ message: 'وضعیت تغییر کرد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/announcements/:id ──
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await db.execute('DELETE FROM announcements WHERE id=?', [req.params.id]);
    res.json({ message: 'اعلان حذف شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
