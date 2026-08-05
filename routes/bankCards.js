const router = require('express').Router();
const db = require('../config/database');
const { auth } = require('../middleware/auth');
const { protectCardNumber, publicCard } = require('../lib/bankCards');

router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id,title,last4,created_at FROM user_bank_cards WHERE user_id=? ORDER BY id DESC LIMIT 20', [req.user.id]);
    res.json({ cards: rows.map(publicCard) });
  } catch (err) { res.status(500).json({ message: 'خطا در دریافت کارت‌ها' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const card = protectCardNumber(req.body.card_number);
    const title = String(req.body.title || '').trim().slice(0, 80) || null;
    const [result] = await db.execute('INSERT INTO user_bank_cards (user_id,encrypted_number,number_iv,number_tag,fingerprint,last4,title) VALUES (?,?,?,?,?,?,?)', [req.user.id,card.encryptedNumber,card.iv,card.tag,card.fingerprint,card.last4,title]);
    res.status(201).json({ card: publicCard({ id:result.insertId,title,last4:card.last4 }) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message:'این کارت قبلاً ذخیره شده است' });
    res.status(400).json({ message:err.message || 'شماره کارت نامعتبر است' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const [result] = await db.execute('DELETE FROM user_bank_cards WHERE id=? AND user_id=?', [req.params.id,req.user.id]);
    if (!result.affectedRows) return res.status(404).json({ message:'کارت یافت نشد' });
    res.json({ message:'کارت حذف شد' });
  } catch (err) { res.status(500).json({ message:'خطا در حذف کارت' }); }
});

module.exports = router;
