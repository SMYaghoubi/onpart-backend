const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const db     = require('../config/database');
const SMS    = require('../config/sms');
const { createNotif } = require('../config/notif');
const { auth, adminAuth } = require('../middleware/auth');
const { createUserNotification } = require('../lib/userNotifications');

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_PATH || './uploads'),
  filename:    (req, file, cb) => cb(null, `receipt_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('فرمت فایل مجاز نیست'));
  }
});

// ── GET /api/payments ──
router.get('/', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { status } = req.query;
    let where = isAdmin ? [] : ['p.user_id=?'];
    const params = isAdmin ? [] : [req.user.id];
    if (status) { where.push('p.status=?'); params.push(status); }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.execute(
      `SELECT p.*, u.name as user_name, u.phone as user_phone
       FROM payments p LEFT JOIN users u ON p.user_id=u.id
       ${whereStr} ORDER BY p.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/payments/receipt ── (upload)
router.post('/receipt', auth, upload.single('file'), async (req, res) => {
  try {
    const { amount, bank, track_number, pay_date, order_id, src_card, dest_account } = req.body;
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      return res.status(400).json({ message: 'مبلغ واریزی نامعتبر است' });

    const receiptFile = req.file?.filename || null;
    const safePayDate = pay_date && pay_date.trim() ? pay_date : null;

    const [result] = await db.execute(
      'INSERT INTO payments (user_id,order_id,amount,bank,track_number,receipt_file,pay_date,src_card,dest_account) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.user.id, order_id || null, amount, bank, track_number, receiptFile, safePayDate, src_card||null, dest_account||null]
    );

    // Notify admin and send SMS to customer
    const [[user]] = await db.execute('SELECT name,phone FROM users WHERE id=?', [req.user.id]);
    await SMS.paymentSubmitted(user?.phone, user?.name || 'کاربر', order_id);
    await SMS.notifyAdmin('notif_new_payment', `فیش واریز جدید از ${user?.name||user?.phone||'کاربر'} به مبلغ ${Number(amount).toLocaleString()} تومان ثبت شد.`);
    await createNotif('payment', `فیش واریز جدید`, `${user?.name||user?.phone||'کاربر'} فیش واریز به مبلغ ${Number(amount).toLocaleString()} تومان ثبت کرد`, '/admin/payments.html');
    await createUserNotification(req.user.id, 'فیش پرداخت ثبت شد', 'فیش پرداخت شما ثبت شد و در انتظار بررسی است.', 'info', '/payment.html');

    res.status(201).json({ id: result.insertId, message: 'فیش واریز ثبت شد' });
  } catch (err) {
    console.error('Payment receipt upload error:', err.message);
    res.status(500).json({ message: 'خطای سرور: ' + err.message });
  }
});

// ── PATCH /api/payments/:id/approve ── (admin)
router.patch('/:id/approve', adminAuth, async (req, res) => {
  try {
    const [[payment]] = await db.execute('SELECT * FROM payments WHERE id=?', [req.params.id]);
    if (!payment) return res.status(404).json({ message: 'پرداخت یافت نشد' });

    await db.execute(
      'UPDATE payments SET status="approved", reviewed_by=?, reviewed_at=NOW() WHERE id=?',
      [req.user.id, req.params.id]
    );
    // Reduce user debt
    await db.execute('UPDATE users SET debt=GREATEST(0, debt-?) WHERE id=?', [payment.amount, payment.user_id]);

    // If linked to an order, move it to preparing stage
    if (payment.order_id) {
      await db.execute('UPDATE orders SET status="preparing" WHERE id=? AND status="pending_payment"', [payment.order_id]);
    }

    // SMS
    const [[user]] = await db.execute('SELECT * FROM users WHERE id=?', [payment.user_id]);
    await SMS.paymentConfirmed(user.phone, user.name || 'کاربر', payment.order_id);
    await createUserNotification(
      payment.user_id,
      'درخواست شما در حال تأمین است',
      'پرداخت تأیید شد؛ پس از تأمین و جمع‌آوری، سفارش برای شما ارسال می‌شود.',
      'success',
      '/orders.html',
      'preparing'
    );

    res.json({ message: 'پرداخت تأیید شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/payments/:id/reject ── (admin)
router.patch('/:id/reject', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const [[payment]] = await db.execute('SELECT * FROM payments WHERE id=?', [req.params.id]);
    if (!payment) return res.status(404).json({ message: 'پرداخت یافت نشد' });

    await db.execute(
      'UPDATE payments SET status="rejected", note=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
      [reason, req.user.id, req.params.id]
    );

    const [[user]] = await db.execute('SELECT * FROM users WHERE id=?', [payment.user_id]);
    if (user) await SMS.paymentRejected(user.phone, user.name || 'کاربر', payment.order_id);
    await createUserNotification(payment.user_id, 'پرداخت رد شد', reason || 'پرداخت شما تأیید نشد؛ لطفاً اطلاعات فیش را بررسی کنید.', 'warning', '/payment.html');

    res.json({ message: 'پرداخت رد شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/payments/:id ── (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const [result] = await db.execute('DELETE FROM payments WHERE id=?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'پرداخت یافت نشد' });
    res.json({ message: 'پرداخت حذف شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
