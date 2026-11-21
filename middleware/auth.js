const jwt = require('jsonwebtoken');
const db  = require('../config/database');
const { managementTokenStatus, managementStoredRoleStatus } = require('../lib/managementAccess');

// Simple in-memory cache for user status (5 minute TTL)
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getUser(id, { fresh = false } = {}) {
  const cached = userCache.get(id);
  if (!fresh && cached && Date.now() - cached.time < CACHE_TTL) return cached.user;
  const [[user]] = await db.execute('SELECT id,role,status FROM users WHERE id=?', [id]);
  if (user) userCache.set(id, { user, time: Date.now() });
  return user || null;
}

// Call this when user is deleted/blocked to invalidate cache
function invalidateUserCache(id) { userCache.delete(id); }

// Verify any logged-in user
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'توکن ارائه نشده' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.context && decoded.context !== 'shop') return res.status(403).json({ message: 'این نشست برای فروشگاه صادر نشده است' });
    const user = await getUser(decoded.id, { fresh: true });
    if (!user) return res.status(401).json({ message: 'حساب کاربری یافت نشد' });
    if (user.status === 'blocked') return res.status(403).json({ message: 'حساب کاربری مسدود شده است' });
    if (user.status !== 'active') return res.status(403).json({ message: 'حساب شما هنوز توسط مدیریت تأیید نشده است' });
    req.user = { ...decoded, role: user.role, status: user.status };
    next();
  } catch(err) {
    res.status(401).json({ message: 'توکن نامعتبر است' });
  }
};

// A registration session can only be used by the profile completion route.
const registrationAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'ابتدا شماره همراه را تأیید کنید' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.context !== 'registration') return auth(req, res, next);
    const user = await getUser(decoded.id, { fresh: true });
    if (!user || user.role !== 'user' || user.status !== 'pending') {
      return res.status(403).json({ message: 'نشست ثبت‌نام دیگر قابل استفاده نیست' });
    }
    const completing = req.body?.isRegistration === true || req.body?.isRegistration === 'true';
    const documentsOnly = Object.keys(req.body || {}).length === 0;
    if (!completing && !documentsOnly) return res.status(403).json({ message: 'این نشست فقط برای تکمیل ثبت‌نام است' });
    req.user = { ...decoded, role: user.role, status: user.status };
    next();
  } catch (error) {
    res.status(401).json({ message: 'نشست ثبت‌نام نامعتبر است' });
  }
};

// Verify admin only
const adminAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'دسترسی غیرمجاز' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const tokenStatus = managementTokenStatus(decoded.role, Boolean(decoded.id));
    if (decoded.context && decoded.context !== 'management') return res.status(403).json({ message: 'این نشست برای پنل مدیریت صادر نشده است' });
    if (tokenStatus === 403) return res.status(403).json({ message: 'مجوز کافی برای مدیریت تأمین‌کنندگان ندارید' });
    if (tokenStatus === 401) return res.status(401).json({ message: 'نشست مدیریت نامعتبر است' });
    const user = await getUser(decoded.id, { fresh: true });
    if (!user) return res.status(401).json({ message: 'حساب کاربری یافت نشد' });
    if (managementStoredRoleStatus(user.role) !== 200) return res.status(403).json({ message: 'مجوز کافی برای عملیات مدیریتی ندارید' });
    if (user.status !== 'active') return res.status(403).json({ message: 'حساب مدیریت فعال نیست' });
    req.user = { ...decoded, role: user.role };
    next();
  } catch(err) {
    res.status(401).json({ message: 'توکن نامعتبر است' });
  }
};

const supplierAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'ابتدا وارد پنل تأمین‌کنندگان شوید' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'supplier' || !decoded.supplier_id) throw new Error('invalid supplier token');
    const [[supplier]] = await db.execute(
      'SELECT id,company,name,mobile,status,portal_enabled FROM suppliers WHERE id=?',
      [decoded.supplier_id]
    );
    if (!supplier || supplier.status !== 'approved' || !supplier.portal_enabled)
      return res.status(403).json({ message: 'دسترسی پنل تأمین‌کننده فعال نیست' });
    req.supplier = supplier;
    next();
  } catch (err) {
    res.status(401).json({ message: 'نشست تأمین‌کننده نامعتبر است' });
  }
};

module.exports = { auth, registrationAuth, adminAuth, supplierAuth, invalidateUserCache };
