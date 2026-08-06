const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const db     = require('../config/database');
const SMS    = require('../config/sms');
const { createNotif } = require('../config/notif');
const { auth, adminAuth } = require('../middleware/auth');
const {
  createUserNotification,
  deleteUserNotificationsForEntity,
  broadcastUserNotificationsChanged,
  broadcastUserDataChanged
} = require('../lib/userNotifications');
const { approvePayment } = require('../lib/paymentApproval');
const { revealCardNumber } = require('../lib/bankCards');
const { resolveAdminNotification, notifyAdminNotificationsChanged } = require('../lib/adminNotifications');
const { PAYMENT_SOUND_KEYS, orderStatusAfterPaymentRejection } = require('../lib/paymentStates');

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
    rows.forEach(row => { const digits=String(row.src_card || '').replace(/\D/g,''); row.src_card=digits ? '****-****-****-' + digits.slice(-4) : null; });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/payments/receipt ── (upload)
router.post('/receipt', auth, upload.single('file'), async (req, res) => {
  try {
    const { amount, bank, track_number, pay_date, order_id, saved_card_id, dest_account } = req.body;
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      return res.status(400).json({ message: 'مبلغ واریزی نامعتبر است' });

    let sourceCardMasked = null;
    let sourceBank = String(bank || '').trim();
    let savedCardId = null;
    if (saved_card_id) {
      const [[savedCard]] = await db.execute('SELECT * FROM user_bank_cards WHERE id=? AND user_id=?', [saved_card_id,req.user.id]);
      if (!savedCard) return res.status(400).json({ message:'کارت انتخاب‌شده متعلق به شما نیست' });
      const resolvedNumber = revealCardNumber(savedCard);
      sourceCardMasked = '****-****-****-' + resolvedNumber.slice(-4);
      sourceBank = savedCard.bank_name || sourceBank;
      savedCardId = savedCard.id;
    }
    const receiptFile = req.file?.filename || null;
    const safePayDate = pay_date && pay_date.trim() ? pay_date : null;

    const [result] = await db.execute(
      'INSERT INTO payments (user_id,order_id,amount,bank,track_number,receipt_file,pay_date,src_card,saved_card_id,dest_account) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [req.user.id, order_id || null, amount, sourceBank, track_number, receiptFile, safePayDate, sourceCardMasked, savedCardId, dest_account||null]
    );

    // Notify admin and send SMS to customer
    const [[user]] = await db.execute('SELECT name,phone FROM users WHERE id=?', [req.user.id]);
    await SMS.paymentSubmitted(user?.phone, user?.name || 'کاربر', order_id);
    await SMS.notifyAdmin('notif_new_payment', `فیش واریز جدید از ${user?.name||user?.phone||'کاربر'} به مبلغ ${Number(amount).toLocaleString()} تومان ثبت شد.`);
    await createNotif('payment','فیش واریز جدید',(user?.name||user?.phone||'کاربر')+' فیش واریز به مبلغ '+Number(amount).toLocaleString()+' تومان ثبت کرد','/admin/payments','payment',result.insertId);
    await createUserNotification(
      req.user.id,
      'فیش پرداخت ثبت شد',
      `فیش پرداخت #${result.insertId} ثبت شد و در انتظار بررسی است.`,
      'info',
      '/payment',
      PAYMENT_SOUND_KEYS.submitted,
      'payment',
      result.insertId
    );

    res.status(201).json({ id: result.insertId, message: 'فیش واریز ثبت شد' });
  } catch (err) {
    console.error('Payment receipt upload error:', err.message);
    res.status(500).json({ message: 'خطای سرور: ' + err.message });
  }
});

// ── PATCH /api/payments/:id/approve ── (admin)
router.patch('/:id/approve', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await approvePayment(conn, req.params.id, req.user.id);
    if (result.notFound) {
      await conn.rollback();
      return res.status(404).json({ message: 'پرداخت یافت نشد' });
    }
    if (!result.alreadyApproved) await resolveAdminNotification(conn,'payment',req.params.id,'/admin/payments');
    await conn.commit();
    if (!result.alreadyApproved) notifyAdminNotificationsChanged({ entity_type:'payment', entity_id:Number(req.params.id), resolved:true });

    if (result.alreadyApproved) {
      broadcastUserDataChanged('payment', 'approved');
      return res.json({ message: 'این پرداخت قبلاً تأیید شده است', already_approved: true });
    }

    const { payment, user, debt, remaining } = result;
    try { await SMS.paymentConfirmed(user.phone, user.name || 'کاربر', payment.order_id); }
    catch (smsError) { console.error('Payment confirmation SMS failed:', smsError.message); }
    await createUserNotification(
      payment.user_id,
      'فیش واریزی شما تأیید شد',
      remaining > 0
        ? 'پرداخت تأیید شد؛ ' + Number(remaining).toLocaleString() + ' تومان از بدهی سفارش باقی مانده است.'
        : 'پرداخت تأیید شد و بدهی سفارش تسویه گردید.',
      'success',
      '/orders',
      PAYMENT_SOUND_KEYS.approved,
      payment.order_id ? 'order' : 'payment',
      payment.order_id || payment.id
    );
    broadcastUserDataChanged('payment', 'approved');
    if (payment.order_id) broadcastUserDataChanged('order', 'updated');

    res.json({ message: 'پرداخت تأیید شد و بدهی به‌روزرسانی شد', debt, debt_remaining: remaining });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('Payment approval failed:', err.message);
    res.status(500).json({ message: 'خطای سرور' });
  } finally { conn.release(); }
});

// PATCH /api/payments/:id/reject
router.patch('/:id/reject', adminAuth, async (req, res) => {
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[payment]]=await conn.execute('SELECT * FROM payments WHERE id=? FOR UPDATE',[req.params.id]);
    if(!payment){await conn.rollback();return res.status(404).json({message:'پرداخت یافت نشد'})}
    if(payment.status==='rejected'){await conn.commit();return res.json({message:'این پرداخت قبلاً رد شده است',already_rejected:true})}
    if(payment.status==='approved'){await conn.rollback();return res.status(409).json({message:'پرداخت تأییدشده قابل رد نیست'})}
    await conn.execute('UPDATE payments SET status="rejected",note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',[String(req.body.reason||'').slice(0,1000)||null,req.user.id,payment.id]);
    if(payment.order_id) await conn.execute('UPDATE orders SET status=? WHERE id=? AND user_id=?',[orderStatusAfterPaymentRejection(),payment.order_id,payment.user_id]);
    await resolveAdminNotification(conn,'payment',payment.id,'/admin/payments');
    const [[user]]=await conn.execute('SELECT name,phone FROM users WHERE id=?',[payment.user_id]);
    await conn.commit();
    notifyAdminNotificationsChanged({ entity_type:'payment', entity_id:Number(payment.id), resolved:true });
    if(user){try{await SMS.paymentRejected(user.phone,user.name||'کاربر',payment.order_id)}catch(smsError){console.error('Payment rejection SMS failed:',smsError.message)}}
    await createUserNotification(payment.user_id,'فیش واریزی شما رد شد',req.body.reason||'فیش واریزی توسط واحد مالی رد شد؛ لطفاً با پشتیبانی تماس بگیرید.','warning','/payment',PAYMENT_SOUND_KEYS.rejected,'payment',payment.id);
    broadcastUserDataChanged('payment','rejected');
    if(payment.order_id) broadcastUserDataChanged('order','updated');
    res.json({message:'پرداخت رد شد',status:'rejected'});
  } catch(err){try{await conn.rollback()}catch(_){}console.error('Payment rejection failed:',err.message);res.status(500).json({message:'خطای سرور'})}
  finally{conn.release()}
});

// DELETE /api/payments/:id
router.delete('/:id', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[payment]] = await conn.execute('SELECT id,user_id FROM payments WHERE id=? FOR UPDATE', [req.params.id]);
    if (!payment) {
      await conn.rollback();
      return res.status(404).json({ message: 'پرداخت یافت نشد' });
    }
    await deleteUserNotificationsForEntity(conn, payment.user_id, 'payment', payment.id, '/payment');
    await conn.execute('DELETE FROM payments WHERE id=?', [payment.id]);
    await conn.commit();
    broadcastUserNotificationsChanged();
    res.json({ message: 'پرداخت و اعلان‌های مرتبط حذف شدند' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    res.status(500).json({ message: 'خطای سرور' });
  } finally { conn.release(); }
});

module.exports = router;
