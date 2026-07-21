const router = require('express').Router();
const db     = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');
const SMS    = require('../config/sms');
const { createNotif } = require('../config/notif');
const multer = require('multer');
const path   = require('path');

const uploadPath = process.env.UPLOAD_PATH || './uploads';
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => cb(null, `credit_${Date.now()}_${file.fieldname}${path.extname(file.originalname).toLowerCase()}`)
});
const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg','.jpeg','.png','.gif','.webp','.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  allowed.includes(ext) ? cb(null, true) : cb(new Error('فقط تصویر و PDF مجاز است'), false);
};
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });

// ── GET /api/credit ── (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT cr.*, u.name as user_name, u.phone as user_phone, u.city as user_city
       FROM credit_requests cr JOIN users u ON cr.user_id=u.id
       ORDER BY cr.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/credit ── (user)
router.post('/', auth, upload.fields([
  { name: 'id_card_file', maxCount: 1 },
  { name: 'guarantee_file', maxCount: 1 },
  { name: 'job_file', maxCount: 1 },
  { name: 'other_file', maxCount: 1 }
]), async (req, res) => {
  try {
    const { amount, guarantee_type, guarantee_detail,
            full_name, mobile, national_code, job,
            province, city, address } = req.body;

    if (!amount || !guarantee_type)
      return res.status(400).json({ message: 'اطلاعات ناقص است' });

    const id_card_file   = req.files?.id_card_file?.[0]?.filename || null;
    const guarantee_file = req.files?.guarantee_file?.[0]?.filename || null;
    const job_file       = req.files?.job_file?.[0]?.filename || null;
    const other_file     = req.files?.other_file?.[0]?.filename || null;

    const [result] = await db.execute(
      `INSERT INTO credit_requests 
       (user_id,amount,guarantee_type,guarantee_detail,full_name,mobile,national_code,job,province,city,address,id_card_file,guarantee_file,job_file,other_file)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, amount, guarantee_type, guarantee_detail||'',
       full_name||'', mobile||'', national_code||'', job||'',
       province||'', city||'', address||'',
       id_card_file, guarantee_file, job_file, other_file]
    );

    res.status(201).json({ id: result.insertId, message: 'درخواست اعتبار ثبت شد' });
    await createNotif('credit', 'درخواست اعتبار جدید', `از ${full_name||'کاربر'} به مبلغ ${Number(amount).toLocaleString()} تومان`, '/admin/credit.html');
  } catch (err) {
    console.error('Credit POST error:', err.message);
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/credit/:id/approve ── (admin)
router.patch('/:id/approve', adminAuth, async (req, res) => {
  try {
    const { approved_amount } = req.body;
    const [[request]] = await db.execute('SELECT * FROM credit_requests WHERE id=?', [req.params.id]);
    if (!request) return res.status(404).json({ message: 'درخواست یافت نشد' });

    const finalAmount = approved_amount || request.amount;
    await db.execute(
      'UPDATE credit_requests SET status="approved", approved_amount=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
      [finalAmount, req.user.id, req.params.id]
    );
    await db.execute('UPDATE users SET credit_limit=credit_limit+? WHERE id=?', [finalAmount, request.user_id]);

    const [[user]] = await db.execute('SELECT phone, name FROM users WHERE id=?', [request.user_id]);
    if (user) await SMS.send(user.phone, `درخواست اعتبار شما به مبلغ ${finalAmount.toLocaleString()} تومان تأیید شد. آن‌پارت`);

    res.json({ message: 'درخواست تأیید شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/credit/:id/reject ── (admin)
router.patch('/:id/reject', adminAuth, async (req, res) => {
  try {
    const { note } = req.body;
    const [[request]] = await db.execute('SELECT * FROM credit_requests WHERE id=?', [req.params.id]);
    if (!request) return res.status(404).json({ message: 'درخواست یافت نشد' });

    await db.execute(
      'UPDATE credit_requests SET status="rejected", note=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
      [note || '', req.user.id, req.params.id]
    );

    const [[user]] = await db.execute('SELECT phone FROM users WHERE id=?', [request.user_id]);
    if (user) await SMS.send(user.phone, `متأسفانه درخواست اعتبار شما رد شد. آن‌پارت`);

    res.json({ message: 'درخواست رد شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/credit/:id ── (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await db.execute('DELETE FROM credit_requests WHERE id=?', [req.params.id]);
    res.json({ message: 'درخواست حذف شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
