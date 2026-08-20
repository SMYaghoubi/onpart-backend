const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../config/database');
const SMS     = require('../config/sms');

const sign = async (user, context = 'shop') => {
  let days = process.env.JWT_EXPIRES || '7d';
  try {
    const [rows] = await db.execute('SELECT value FROM settings WHERE `key`="jwt_expires_days"');
    if (rows[0]?.value) days = rows[0].value + 'd';
  } catch (e) {}
  return jwt.sign(
    { id: user.id, phone: user.phone, role: user.role, name: user.name, context },
    process.env.JWT_SECRET,
    { expiresIn: days }
  );
};

// ── POST /api/auth/send-otp ──
router.post('/send-otp', async (req, res) => {
  try {
    const { phone, purpose } = req.body;
    if (!phone || !/^09\d{9}$/.test(phone))
      return res.status(400).json({ message: 'شماره موبایل نامعتبر است' });

    // اگر برای ثبت‌نام است، بررسی کن که این شماره از قبل حساب کاربری کامل نداشته باشد
    if (purpose === 'register') {
      const [rows] = await db.execute('SELECT id, name FROM users WHERE phone=?', [phone]);
      if (rows.length && rows[0].name) {
        return res.status(400).json({ message: 'شما دارای حساب کاربری در آن‌پارت می‌باشید' });
      }
    }

    await SMS.sendOTP(phone);
    res.json({ message: 'کد تأیید ارسال شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطا در ارسال کد' });
  }
});

// ── POST /api/auth/verify-otp ──
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;
    const valid = await SMS.verifyOTP(phone, code);
    if (!valid) return res.status(400).json({ message: 'کد نامعتبر یا منقضی شده' });

    // Get or create user
    let [rows] = await db.execute('SELECT * FROM users WHERE phone=?', [phone]);
    let user = rows[0];
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const [result] = await db.execute(
        'INSERT INTO users (phone, role, status) VALUES (?,?,?)',
        [phone, 'user', 'active']
      );
      [rows] = await db.execute('SELECT * FROM users WHERE id=?', [result.insertId]);
      user = rows[0];
    }

    if (user.status === 'pending')
      return res.status(403).json({ message: 'حساب شما در انتظار تأیید مدیر است' });

    if (user.status === 'blocked')
      return res.status(403).json({ message: 'حساب شما مسدود شده است' });

    res.json({ token: await sign(user, 'shop'), user: { id: user.id, name: user.name, phone: user.phone, role: user.role }, isNewUser });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/auth/login (admin) ──
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ message: 'اطلاعات ناقص است' });

    const [rows] = await db.execute(
      'SELECT * FROM users WHERE (phone=? OR email=?) AND role IN ("admin","partner")',
      [username, username]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ message: 'نام کاربری یا رمز اشتباه است' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'نام کاربری یا رمز اشتباه است' });

    if (user.status === 'blocked')
      return res.status(403).json({ message: 'حساب مسدود شده' });

    if (user.status !== 'active')
      return res.status(403).json({ message: 'حساب مدیریت فعال نیست' });

    await db.execute('UPDATE users SET last_login_at=UTC_TIMESTAMP() WHERE id=?', [user.id]);
    res.json({ token: await sign(user, 'management'), user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/auth/user-login (shop users) ──
router.post('/user-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ message: 'اطلاعات ناقص است' });

    const [rows] = await db.execute(
      'SELECT * FROM users WHERE (phone=? OR email=?) ',
      [username, username]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ message: 'شماره موبایل یا رمز عبور اشتباه است' });

    if (!user.password) return res.status(401).json({ message: 'رمز عبور تنظیم نشده. از OTP استفاده کنید' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'شماره موبایل یا رمز عبور اشتباه است' });

    if (user.status === 'blocked')
      return res.status(403).json({ message: 'حساب شما مسدود شده است' });

    if (user.status === 'pending')
      return res.status(403).json({ message: 'حساب شما در انتظار تأیید مدیر است' });

    if (user.status !== 'active')
      return res.status(403).json({ message: 'حساب شما فعال نیست' });

    // Send welcome SMS only on first successful login
    if (!user.welcomed) {
      await db.execute('UPDATE users SET welcomed=1 WHERE id=?', [user.id]);
      await SMS.welcome(user.phone, user.name || 'کاربر گرامی');
    }

    res.json({ token: await sign(user, 'shop'), user: { id: user.id, name: user.name, phone: user.phone, role: user.role, city: user.city } });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/auth/change-password ──
const { auth, adminAuth } = require('../middleware/auth');

// POST /api/auth/logout (management) - record only an authenticated explicit logout.
router.post('/logout', adminAuth, async (req,res)=>{
  try {
    await db.execute('UPDATE users SET last_logout_at=UTC_TIMESTAMP() WHERE id=?',[req.user.id]);
    res.json({message:'خروج از پنل ثبت شد'});
  } catch(err) {
    res.status(500).json({message:'ثبت خروج انجام نشد؛ نشست شما هنوز پاک نشده است'});
  }
});
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const [rows] = await db.execute('SELECT * FROM users WHERE id=?', [req.user.id]);
    const user = rows[0];

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(400).json({ message: 'رمز عبور فعلی اشتباه است' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password=? WHERE id=?', [hashed, req.user.id]);
    res.json({ message: 'رمز عبور تغییر کرد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
