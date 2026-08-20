const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
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
const { syncUserDebt } = require('../lib/orderDebt');
const { calculateOrderDebt, reconcileOrderDebt } = require('../lib/debtReconciliation');
const { revealCardNumber } = require('../lib/bankCards');
const { resolveAdminNotification, notifyAdminNotificationsChanged } = require('../lib/adminNotifications');
const { PAYMENT_SOUND_KEYS, orderStatusAfterPaymentRejection } = require('../lib/paymentStates');
const { getPaymentAllocations, reconcileOrdersAfterAllocationRemoval } = require('../lib/paymentAllocations');
const { isAllowedReceiptUpload, canReadReceipt, resolveReceiptPath, receiptMime } = require('../lib/paymentReceipts');
const { paymentReadMode, buildPaymentListQuery, mapPaymentRows } = require('../lib/paymentList');

function paymentReadAuth(req, res, next) {
  return paymentReadMode(req.query) === 'management' ? adminAuth(req, res, next) : auth(req, res, next);
}

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_PATH || './uploads'),
  filename:    (req, file, cb) => cb(null, `receipt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAllowedReceiptUpload(file.originalname, file.mimetype)) cb(null, true);
    else cb(new Error('فرمت فایل مجاز نیست'));
  }
});

// ── GET /api/payments ──
router.get('/', paymentReadAuth, async (req, res) => {
  try {
    const mode=paymentReadMode(req.query);
    const query=buildPaymentListQuery({mode,userId:req.user.id,status:req.query.status});
    const [rows]=await db.execute(query.sql,query.params);
    res.json(mapPaymentRows(rows));
  } catch (err) {
    console.error('Payment list failed:', err.code || '', err.message);
    res.status(err.statusCode||500).json({ message:err.statusCode?err.message:'خطا در دریافت فهرست پرداخت‌ها' });
  }
});
// ── GET /api/payments/:id/receipt ── protected owner/admin receipt stream
router.get('/:id/receipt', paymentReadAuth, async (req, res) => {
  try {
    const [[payment]] = await db.execute('SELECT id,user_id,receipt_file FROM payments WHERE id=?', [req.params.id]);
    if (!payment) return res.status(404).json({ message:'پرداخت یافت نشد' });
    if (!canReadReceipt(req.user, payment)) return res.status(403).json({ message:'دسترسی غیرمجاز' });
    if (!payment.receipt_file) return res.status(404).json({ message:'فیشی برای این پرداخت ثبت نشده است' });
    const resolved = resolveReceiptPath(process.env.UPLOAD_PATH || './uploads', payment.receipt_file);
    const mime = receiptMime(payment.receipt_file);
    if (!resolved || !mime) return res.status(400).json({ message:'مسیر فایل فیش نامعتبر است' });
    try { await fs.promises.access(resolved, fs.constants.R_OK); }
    catch (_) { return res.status(404).json({ message:'فایل فیش در فضای ذخیره‌سازی یافت نشد' }); }
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${req.query.download==='1'?'attachment':'inline'}; filename="receipt-${payment.id}${path.extname(payment.receipt_file).toLowerCase()}"`);
    return res.sendFile(resolved);
  } catch (error) {
    console.error('Payment receipt retrieval failed:', error.message);
    return res.status(500).json({ message:'خطا در دریافت فایل فیش' });
  }
});
// ── POST /api/payments/receipt ── (upload)
router.post('/receipt', auth, upload.single('file'), async (req, res) => {
  try {
    const { amount, bank, track_number, pay_date, order_id, saved_card_id, dest_account } = req.body;
    const numericAmount=Number(amount);
    if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0)
      return res.status(400).json({ message: 'مبلغ واریزی نامعتبر است' });

    let linkedOrder = null;
    if (order_id) {
      [[linkedOrder]] = await db.execute(
        `SELECT o.id,o.user_id,o.status,o.total,o.debt_remaining,
          COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.order_id=o.id),0) approved_amount
         FROM orders o WHERE o.id=? AND o.user_id=?`,
        [order_id, req.user.id]
      );
      if (!linkedOrder) return res.status(400).json({ message:'سفارش انتخاب‌شده متعلق به شما نیست' });
      if (linkedOrder.status !== 'pending_payment' || calculateOrderDebt(linkedOrder.total,linkedOrder.approved_amount,linkedOrder.status) <= 0)
        return res.status(409).json({ message:'این سفارش بدهی قابل پرداخت ندارد' });
    }

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
      'INSERT INTO payments (user_id,order_id,amount,bank,track_number,receipt_file,pay_date,src_card,saved_card_id,dest_account,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [req.user.id, order_id || null, numericAmount, sourceBank, track_number, receiptFile, safePayDate, sourceCardMasked, savedCardId, dest_account||null, 'pending']
    );

    // Notify admin and send SMS to customer
    const [[user]] = await db.execute('SELECT name,phone FROM users WHERE id=?', [req.user.id]);
    try { await SMS.paymentSubmitted(user?.phone, user?.name || 'کاربر', order_id); }
    catch(error){ console.error('Payment submitted customer SMS failed:',error.message); }
    try { await SMS.notifyAdmin('notif_new_payment', `فیش واریز جدید از ${user?.name||user?.phone||'کاربر'} به مبلغ ${Number(amount).toLocaleString()} تومان ثبت شد.`); }
    catch(error){ console.error('Payment submitted admin SMS failed:',error.message); }
    try { await createNotif('payment','فیش واریز جدید',(user?.name||user?.phone||'کاربر')+' فیش واریز به مبلغ '+Number(amount).toLocaleString()+' تومان ثبت کرد','/admin/payments','payment',result.insertId); }
    catch(error){ console.error('Payment submitted admin notification failed:',error.message); }
    try { await createUserNotification(
      req.user.id,
      'فیش پرداخت ثبت شد',
      `فیش پرداخت #${result.insertId} ثبت شد و در انتظار بررسی است.`,
      'info','/payment',PAYMENT_SOUND_KEYS.submitted,'payment',result.insertId
    ); } catch(error){ console.error('Payment submitted user notification failed:',error.message); }

    broadcastUserDataChanged('payment','submitted');
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

    const { payment, user, debt, remaining, allocations, unallocatedAmount } = result;
    try { await SMS.paymentConfirmed(user.phone, user.name || 'کاربر', payment.order_id); }
    catch (smsError) { console.error('Payment confirmation SMS failed:', smsError.message); }
    try { await createUserNotification(
      payment.user_id,
      'فیش واریزی شما تأیید شد',
      debt > 0
        ? 'پرداخت تأیید شد؛ ' + Number(debt).toLocaleString() + ' تومان از بدهی شما باقی مانده است.'
        : 'پرداخت تأیید شد و بدهی شما تسویه گردید.',
      'success',
      '/orders',
      PAYMENT_SOUND_KEYS.approved,
      allocations.length ? 'order' : 'payment',
      allocations.length ? allocations[0].order_id : payment.id
    ); } catch(error){ console.error('Payment approval user notification failed:',error.message); }
    broadcastUserDataChanged('payment', 'approved');
    if (allocations.length) broadcastUserDataChanged('order', 'updated');

    res.json({ message: 'پرداخت تأیید شد و بدهی به‌روزرسانی شد', debt, debt_remaining: remaining, allocations, unallocated_amount:unallocatedAmount });
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
    if(payment.order_id) {
      await conn.execute('UPDATE orders SET status=? WHERE id=? AND user_id=?',[orderStatusAfterPaymentRejection(),payment.order_id,payment.user_id]);
      await reconcileOrderDebt(conn,payment.order_id);
    }
    const debt=await syncUserDebt(conn,payment.user_id);
    await resolveAdminNotification(conn,'payment',payment.id,'/admin/payments');
    const [[user]]=await conn.execute('SELECT name,phone FROM users WHERE id=?',[payment.user_id]);
    await conn.commit();
    notifyAdminNotificationsChanged({ entity_type:'payment', entity_id:Number(payment.id), resolved:true });
    if(user){try{await SMS.paymentRejected(user.phone,user.name||'کاربر',payment.order_id)}catch(smsError){console.error('Payment rejection SMS failed:',smsError.message)}}
    try { await createUserNotification(payment.user_id,'فیش واریزی شما رد شد',req.body.reason||'فیش واریزی توسط واحد مالی رد شد؛ لطفاً با پشتیبانی تماس بگیرید.','warning','/payment',PAYMENT_SOUND_KEYS.rejected,'payment',payment.id); } catch(error){ console.error('Payment rejection user notification failed:',error.message); }
    broadcastUserDataChanged('payment','rejected');
    if(payment.order_id) broadcastUserDataChanged('order','updated');
    res.json({message:'پرداخت رد شد',status:'rejected',debt});
  } catch(err){try{await conn.rollback()}catch(_){}console.error('Payment rejection failed:',err.message);res.status(500).json({message:'خطای سرور'})}
  finally{conn.release()}
});

// DELETE /api/payments/:id
router.delete('/:id', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[payment]] = await conn.execute('SELECT id,user_id,order_id,status FROM payments WHERE id=? FOR UPDATE', [req.params.id]);
    if (!payment) {
      await conn.rollback();
      return res.status(404).json({ message: 'پرداخت یافت نشد' });
    }
    const allocations = await getPaymentAllocations(conn, payment.id);
    const affectedOrderIds = [...new Set(allocations.map(row=>Number(row.order_id)).filter(Boolean))];
    if (!affectedOrderIds.length && payment.order_id) affectedOrderIds.push(Number(payment.order_id));
    await deleteUserNotificationsForEntity(conn, payment.user_id, 'payment', payment.id, '/payment');
    await conn.execute('DELETE FROM payments WHERE id=?', [payment.id]);
    const restoredOrders=await reconcileOrdersAfterAllocationRemoval(conn,affectedOrderIds);
    const debt=await syncUserDebt(conn,payment.user_id);
    await conn.commit();
    broadcastUserNotificationsChanged();
    broadcastUserDataChanged('payment','deleted');
    if(affectedOrderIds.length) broadcastUserDataChanged('order','updated');
    res.json({ message: 'پرداخت و اعلان‌های مرتبط حذف شدند', debt, restored_orders:restoredOrders });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    res.status(500).json({ message: 'خطای سرور' });
  } finally { conn.release(); }
});

module.exports = router;
