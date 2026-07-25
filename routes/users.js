const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const db      = require('../config/database');
const { auth, adminAuth, invalidateUserCache } = require('../middleware/auth');
const SMS     = require('../config/sms');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const uploadPath = process.env.UPLOAD_PATH || './uploads';
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadPath); },
  filename: (req, file, cb) => { cb(null, `user_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`); }
});
const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg','.jpeg','.png','.gif','.webp','.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  allowed.includes(ext) ? cb(null, true) : cb(new Error('فقط تصویر و PDF مجاز است'), false);
};
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });

// ── GET /api/users/me ──
router.get('/me', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id,name,phone,email,city,state,address,postal_code,province,shop_name,national_code,phone_fixed,credit_limit,debt,role,status,created_at FROM users WHERE id=?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'کاربر یافت نشد' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/users/:id ──
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id,name,phone,email,city,state,address,postal_code,province,shop_name,national_code,phone_fixed,id_card_image,shop_image,credit_limit,debt,role,status FROM users WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'کاربر یافت نشد' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PUT /api/users/me ──
router.put('/me', auth, upload.fields([
  { name: 'id_card_image', maxCount: 1 },
  { name: 'shop_image', maxCount: 1 }
]), async (req, res) => {
  try {
    // Support both JSON and FormData
    const body = req.body || {};
    const { name, email, city, state, address, postal_code, password, currentPassword, isRegistration,
            shop_name, national_code, phone_fixed, province } = body;
    // اگر کاربر می‌خواهد رمز عبور را تغییر دهد، ابتدا رمز فعلی را تایید کن
    if (password && !isRegistration) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'رمز عبور فعلی الزامی است' });
      }
      const [[existingUser]] = await db.execute('SELECT password FROM users WHERE id=?', [req.user.id]);
      if (!existingUser || !existingUser.password) {
        return res.status(400).json({ message: 'خطا در تایید رمز عبور' });
      }
      const isValid = await bcrypt.compare(currentPassword, existingUser.password);
      if (!isValid) {
        return res.status(400).json({ message: 'رمز عبور فعلی اشتباه است' });
      }
    }

    const idCardImage = req.files?.id_card_image?.[0]?.filename || null;
    const shopImage   = req.files?.shop_image?.[0]?.filename    || null;

    const v = x => (x && String(x).trim()) ? String(x).trim() : null;

    let sql = `UPDATE users SET
      name=COALESCE(?,name), email=COALESCE(?,email), city=COALESCE(?,city),
      state=COALESCE(?,state), address=COALESCE(?,address), postal_code=COALESCE(?,postal_code),
      shop_name=COALESCE(?,shop_name), national_code=COALESCE(?,national_code),
      phone_fixed=COALESCE(?,phone_fixed), province=COALESCE(?,province)`;
    let params = [
      v(name), v(email), v(city), v(state),
      v(address), v(postal_code), v(shop_name),
      v(national_code), v(phone_fixed), v(province)
    ];

    if (idCardImage) { sql += ', id_card_image=?'; params.push(idCardImage); }
    if (shopImage)   { sql += ', shop_image=?';    params.push(shopImage); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      sql += ', password=?'; params.push(hash);
    }

    sql += ' WHERE id=?';
    params.push(req.user.id);
    await db.execute(sql, params);

    if (isRegistration) {
      const [[setting]] = await db.execute('SELECT value FROM settings WHERE `key`="manual_approve"');
      if (setting && setting.value === '1') {
        await db.execute('UPDATE users SET status="pending" WHERE id=?', [req.user.id]);
        const [[pendingUser]] = await db.execute('SELECT phone,name FROM users WHERE id=?', [req.user.id]);
        await SMS.accountPending(pendingUser.phone, pendingUser.name || 'کاربر');
        return res.json({ message: 'ثبت‌نام شما با موفقیت انجام شد. پس از تأیید مدیر امکان ورود خواهید داشت.', pending: true });
      }
    }

    res.json({ message: 'پروفایل به‌روزرسانی شد' });
  } catch (err) {
    console.error('PUT /users/me error:', err.message);
    res.status(500).json({ message: 'خطای سرور', detail: err.message });
  }
});


// ── GET /api/users ── (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { search, status, role, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = [];
    const params = [];

    if (search) { where.push('(name LIKE ? OR phone LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (status) { where.push('status=?'); params.push(status); }
    if (role)   { where.push('role=?');   params.push(role); }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await db.execute(
      `SELECT id,name,phone,email,city,state,address,postal_code,province,shop_name,national_code,phone_fixed,id_card_image,shop_image,role,status,credit_limit,debt,created_at FROM users ${whereStr} ORDER BY id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/users ── (admin - manual add)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { name, phone, email, password, role, city, address, credit_limit } = req.body;
    if(!phone) return res.status(400).json({ message: 'شماره موبایل الزامی است' });
    const hashed = password ? await bcrypt.hash(password, 10) : null;
    const [result] = await db.execute(
      'INSERT INTO users (name, phone, email, password, role, city, address, credit_limit) VALUES (?,?,?,?,?,?,?,?)',
      [name||'', phone, email||null, hashed, role||'user', city||null, address||null, credit_limit||0]
    );
    res.status(201).json({ id: result.insertId, message: 'کاربر اضافه شد' });
  } catch (err) {
    console.error('POST user error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'این شماره موبایل قبلاً ثبت شده' });
    res.status(500).json({ message: 'خطای سرور', error: err.message });
  }
});

// ── PUT /api/users/:id ── (admin)
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { name, email, role, status, city, address, credit_limit, password } = req.body;
    if(password){
      const hashed = await bcrypt.hash(password, 10);
      await db.execute(
        'UPDATE users SET name=?,email=?,role=?,status=?,city=?,address=?,credit_limit=?,password=? WHERE id=?',
        [name||'', email||null, role||'user', status||'active', city||null, address||null, credit_limit||0, hashed, req.params.id]
      );
    } else {
      await db.execute(
        'UPDATE users SET name=?,email=?,role=?,status=?,city=?,address=?,credit_limit=? WHERE id=?',
        [name||'', email||null, role||'user', status||'active', city||null, address||null, credit_limit||0, req.params.id]
      );
    }
    res.json({ message: 'کاربر به‌روزرسانی شد' });
  } catch (err) {
    console.error('PUT user error:', err.message);
    res.status(500).json({ message: 'خطای سرور', error: err.message });
  }
});

// ── PATCH /api/users/:id/block ── (admin)
router.patch('/:id/block', adminAuth, async (req, res) => {
  try {
    const [[user]] = await db.execute('SELECT status FROM users WHERE id=?', [req.params.id]);
    const newStatus = user.status === 'blocked' ? 'active' : 'blocked';
    await db.execute('UPDATE users SET status=? WHERE id=?', [newStatus, req.params.id]);
    invalidateUserCache(Number(req.params.id));
    res.json({ message: newStatus === 'blocked' ? 'کاربر مسدود شد' : 'مسدودی رفع شد', status: newStatus });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/users/:id/status ── (admin) - set status directly
router.patch('/:id/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active','blocked','pending'].includes(status))
      return res.status(400).json({ message: 'وضعیت نامعتبر است' });

    const [[user]] = await db.execute('SELECT * FROM users WHERE id=?', [req.params.id]);
    await db.execute('UPDATE users SET status=? WHERE id=?', [status, req.params.id]);

    if (user) {
      if (status === 'active') await SMS.accountApproved(user.phone, user.name || 'کاربر');
      else if (status === 'pending') await SMS.accountPending(user.phone, user.name || 'کاربر');
    }

    res.json({ message: 'وضعیت کاربر به‌روزرسانی شد', status });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/users/:id ── (admin) - fully removes user and related data
router.delete('/:id', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const userId = req.params.id;
    const [[user]] = await conn.execute('SELECT phone FROM users WHERE id=?', [userId]);
    if (!user) return res.status(404).json({ message: 'کاربر یافت نشد' });

    await conn.beginTransaction();

    // Remove related records first to avoid foreign key issues
    await conn.execute('DELETE FROM otps WHERE phone=?', [user.phone]);
    await conn.execute('DELETE FROM payments WHERE user_id=?', [userId]);
    await conn.execute('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)', [userId]);
    await conn.execute('DELETE FROM orders WHERE user_id=?', [userId]);
    await conn.execute('DELETE FROM invoices WHERE user_id=?', [userId]).catch(()=>{});
    await conn.execute('DELETE FROM sms_logs WHERE phone=?', [user.phone]).catch(()=>{});
    await conn.execute('DELETE FROM users WHERE id=?', [userId]);

    await conn.commit();
    invalidateUserCache(userId);
    res.json({ message: 'کاربر و تمام اطلاعات مرتبط با موفقیت حذف شد' });
  } catch (err) {
    await conn.rollback();
    console.error('Delete user error:', err.message);
    res.status(500).json({ message: 'خطا در حذف کاربر: ' + err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
