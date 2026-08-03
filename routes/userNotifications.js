const router = require('express').Router();
const db = require('../config/database');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id,title,body,type,link,sound_key,entity_type,entity_id,is_read,created_at
       FROM user_notifications WHERE user_id=?
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ notifications: rows });
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054) {
      try {
        let rows;
        try {
          [rows] = await db.execute(
            `SELECT id,title,body,type,link,sound_key,NULL AS entity_type,
                    NULL AS entity_id,is_read,created_at
             FROM user_notifications WHERE user_id=?
             ORDER BY id DESC LIMIT 50`,
            [req.user.id]
          );
        } catch (soundColumnErr) {
          if (soundColumnErr.code !== 'ER_BAD_FIELD_ERROR' && soundColumnErr.errno !== 1054) throw soundColumnErr;
          [rows] = await db.execute(
            `SELECT id,title,body,type,link,NULL AS sound_key,NULL AS entity_type,
                    NULL AS entity_id,is_read,created_at
             FROM user_notifications WHERE user_id=?
             ORDER BY id DESC LIMIT 50`,
            [req.user.id]
          );
        }
        return res.json({ notifications: rows });
      } catch (legacyErr) {
        console.error('GET legacy user notifications failed:', legacyErr.message);
      }
    }
    console.error('GET user notifications failed:', err.message);
    res.status(500).json({ message: 'خطا در دریافت اعلان‌های کاربری' });
  }
});

router.patch('/read-all', auth, async (req, res) => {
  try {
    await db.execute('UPDATE user_notifications SET is_read=1 WHERE user_id=? AND is_read=0', [req.user.id]);
    res.json({ message: 'اعلان‌ها خوانده شدند' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
