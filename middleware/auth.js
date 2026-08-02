const jwt = require('jsonwebtoken');
const db  = require('../config/database');

// Simple in-memory cache for user status (5 minute TTL)
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getUser(id) {
  const cached = userCache.get(id);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.user;
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
    const user = await getUser(decoded.id);
    if (!user) return res.status(401).json({ message: 'حساب کاربری یافت نشد' });
    if (user.status === 'blocked') return res.status(403).json({ message: 'حساب کاربری مسدود شده است' });
    req.user = { ...decoded, role: user.role, status: user.status };
    next();
  } catch(err) {
    res.status(401).json({ message: 'توکن نامعتبر است' });
  }
};

// Verify admin only
const adminAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'دسترسی غیرمجاز' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUser(decoded.id);
    if (!user) return res.status(401).json({ message: 'حساب کاربری یافت نشد' });
    if (user.role !== 'admin' && user.role !== 'partner') return res.status(403).json({ message: 'فقط ادمین دسترسی دارد' });
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

module.exports = { auth, adminAuth, supplierAuth, invalidateUserCache };
