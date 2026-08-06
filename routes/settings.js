const router = require('express').Router();
const db     = require('../config/database');
const { adminAuth } = require('../middleware/auth');
const multer = require('multer');

const bankLogoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, process.env.UPLOAD_PATH || './uploads'),
    filename: (req, file, cb) => {
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype] || '.img';
      cb(null, `bank-logo-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
});

// ── GET /api/settings (public - for shop) ──
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT `key`, value FROM settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    // Only expose safe public settings
    const publicSettings = {
      site_name: settings.site_name,
      site_phone: settings.site_phone,
      site_whatsapp: settings.site_whatsapp,
      site_email: settings.site_email,
      site_address: settings.site_address,
      bank_accounts: settings.bank_accounts,
      site_instagram: settings.site_instagram,
      min_order: settings.min_order,
      tax_rate: settings.tax_rate,
      currency: settings.currency,
      show_price_guest: settings.show_price_guest,
      online_order: settings.online_order,
      show_stock: settings.show_stock,
      maintenance_mode: settings.maintenance_mode,
      otp_enabled: settings.otp_enabled,
      open_register: settings.open_register,
    };
    res.json(publicSettings);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/settings/admin (admin only - all settings) ──
router.get('/admin', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT `key`, value FROM settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/settings/bank-logo (admin only) ──
router.post('/bank-logo', adminAuth, bankLogoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'فایل تصویر معتبر ارسال نشده است' });
  res.status(201).json({ url: `/uploads/${encodeURIComponent(req.file.filename)}` });
});

// ── PUT /api/settings ──
router.put('/', adminAuth, async (req, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await db.execute(
        'INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)',
        [key, String(value||'')]
      );
    }
    res.json({ message: 'تنظیمات ذخیره شد' });
  } catch (err) {
    console.error('Settings save error:', err.message);
    res.status(500).json({ message: 'خطای سرور', error: err.message });
  }
});

module.exports = router;
