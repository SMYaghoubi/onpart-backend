const router = require('express').Router();
const db     = require('../config/database');
const { adminAuth } = require('../middleware/auth');
const { addClient, broadcast } = require('../lib/liveEvents');
const ALLOWED_TYPES = new Set(['info', 'success', 'warning', 'promo']);

function broadcastChange(action, id) {
  broadcast('announcement', { action, id: Number(id) || 0 });
}

function normalizeAnnouncement(body = {}) {
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  const type = ALLOWED_TYPES.has(body.type) ? body.type : 'info';
  const expiresAt = body.expires_at || null;
  if (!title || !text) return { error: 'عنوان و متن الزامی است' };
  if (title.length > 180) return { error: 'عنوان اعلان بیش از حد طولانی است' };
  if (text.length > 5000) return { error: 'متن اعلان بیش از حد طولانی است' };
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) return { error: 'تاریخ انقضا نامعتبر است' };
  return { title, text, type, expiresAt };
}

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
    console.error('GET announcements failed:', err.message);
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// Live announcement stream for storefront clients (Server-Sent Events).
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`event: connected\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  addClient(req, res);
});

// ── GET /api/announcements/admin ── (admin panel - all)
router.get('/admin', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM announcements ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET admin announcements failed:', err.message);
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/announcements ──
router.post('/', adminAuth, async (req, res) => {
  try {
    const data = normalizeAnnouncement(req.body);
    if (data.error) return res.status(400).json({ message: data.error });
    const [result] = await db.execute(
      'INSERT INTO announcements (title, body, type, expires_at, created_by) VALUES (?,?,?,?,?)',
      [data.title, data.text, data.type, data.expiresAt, req.user.id]
    );
    broadcastChange('created', result.insertId);
    res.status(201).json({ id: result.insertId, message: 'اعلان ایجاد شد' });
  } catch (err) {
    console.error('POST announcement failed:', err.message);
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PUT /api/announcements/:id ──
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const data = normalizeAnnouncement(req.body);
    if (data.error) return res.status(400).json({ message: data.error });
    await db.execute(
      'UPDATE announcements SET title=?, body=?, type=?, expires_at=? WHERE id=?',
      [data.title, data.text, data.type, data.expiresAt, req.params.id]
    );
    broadcastChange('updated', req.params.id);
    res.json({ message: 'اعلان ویرایش شد' });
  } catch (err) {
    console.error('PUT announcement failed:', err.message);
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
    broadcastChange('toggled', req.params.id);
    res.json({ message: 'وضعیت تغییر کرد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/announcements/:id ──
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await db.execute('DELETE FROM announcements WHERE id=?', [req.params.id]);
    broadcastChange('deleted', req.params.id);
    res.json({ message: 'اعلان حذف شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
