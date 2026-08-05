require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const rateLimit  = require('express-rate-limit');
const fs         = require('fs');

const app = express();

// ── Trust proxy (required for Liara/reverse proxy) ──
app.set('trust proxy', 1);

// ── Uploads dir ──
let uploadPath = process.env.UPLOAD_PATH || './uploads';
try {
  if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
  process.env.UPLOAD_PATH = uploadPath;
} catch (err) {
  console.error(`Could not create/access upload dir at ${uploadPath}: ${err.message}. File uploads will be disabled until fixed.`);
  // Try /tmp as last resort (always writable in containers)
  try {
    const tmpPath = '/tmp/uploads';
    if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath, { recursive: true });
    uploadPath = tmpPath;
    process.env.UPLOAD_PATH = tmpPath;
    console.log(`Using fallback upload path: ${tmpPath}`);
  } catch (err2) {
    console.error(`Fallback /tmp/uploads also failed: ${err2.message}. Continuing without upload directory.`);
  }
}

// ── Middleware ──
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://onpart.ir',
  'https://www.onpart.ir',
];
if(process.env.NODE_ENV !== 'production'){
  allowedOrigins.push('http://localhost:3000', 'http://localhost:8080');
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Rate Limiting (disabled for now) ──
// Rate limiting
const realtimeReadPaths = new Set([
  '/api/user-notifications',
  '/api/announcements',
  '/api/announcements/stream'
]);
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: req => req.method === 'GET' && realtimeReadPaths.has(req.path),
  message: { message: 'تعداد درخواست زیاد است' }
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { message: 'تعداد درخواست زیاد است، لطفاً کمی صبر کنید' } });

app.use(limiter);
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/supplier-portal/auth', authLimiter);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
// app.use('/api/', limiter);
// app.use('/api/auth/', authLimiter);

// ── Static uploads ──
app.use('/uploads', express.static(uploadPath));

// ── Routes ──
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/sms',      require('./routes/sms'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/credit',   require('./routes/credit'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/user-notifications', require('./routes/userNotifications'));
app.use('/api/suppliers',     require('./routes/suppliers'));
app.use('/api/supplier-portal', require('./routes/supplierPortal'));
app.use('/api/webauthn',      require('./routes/webauthn'));
app.use('/api/cart',          require('./routes/cart'));
// ── Health check ──
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '1.0.0' });
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({ message: 'مسیر یافت نشد' });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'خطای سرور داخلی' });
});

// ── Start ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 OnPart API running on port ${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
