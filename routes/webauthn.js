const router = require('express').Router();
const db     = require('../config/database');
const { auth } = require('../middleware/auth');
const crypto = require('crypto');

// ── GET /api/webauthn/register-options ── generate challenge for registration
router.get('/register-options', auth, async (req, res) => {
  try {
    const [[user]] = await db.execute('SELECT id,name,phone FROM users WHERE id=?', [req.user.id]);
    const challenge = crypto.randomBytes(32).toString('base64url');
    
    // Store challenge temporarily
    await db.execute('UPDATE users SET webauthn_challenge=? WHERE id=?', [challenge, req.user.id]);
    
    res.json({
      challenge,
      rp: { name: 'آن‌پارت', id: 'onpart.ir' },
      user: {
        id: Buffer.from(String(user.id)).toString('base64url'),
        name: user.phone,
        displayName: user.name || user.phone
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' }
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/webauthn/register ── save credential after registration
router.post('/register', auth, async (req, res) => {
  try {
    const { credentialId, publicKey, deviceName } = req.body;
    if (!credentialId || !publicKey) return res.status(400).json({ message: 'اطلاعات ناقص' });
    
    await db.execute(
      'INSERT INTO webauthn_credentials (user_id, credential_id, public_key, device_name) VALUES (?,?,?,?)',
      [req.user.id, credentialId, publicKey, deviceName || 'دستگاه من']
    );
    await db.execute('UPDATE users SET webauthn_enabled=1 WHERE id=?', [req.user.id]);
    
    res.json({ message: 'اثر انگشت با موفقیت ثبت شد' });
  } catch (err) {
    console.error('WebAuthn register error:', err.message);
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/webauthn/auth-options ── generate challenge for authentication
router.post('/auth-options', async (req, res) => {
  try {
    const { phone } = req.body;
    const [[user]] = await db.execute('SELECT id FROM users WHERE phone=?', [phone]);
    if (!user) return res.status(404).json({ message: 'کاربر یافت نشد' });
    
    const [creds] = await db.execute('SELECT credential_id FROM webauthn_credentials WHERE user_id=?', [user.id]);
    if (!creds.length) return res.status(404).json({ message: 'اثر انگشت ثبت نشده' });
    
    const challenge = crypto.randomBytes(32).toString('base64url');
    await db.execute('UPDATE users SET webauthn_challenge=? WHERE id=?', [challenge, user.id]);
    
    res.json({
      challenge,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: creds.map(c => ({ id: c.credential_id, type: 'public-key' }))
    });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/webauthn/authenticate ── verify and login with biometric
router.post('/authenticate', async (req, res) => {
  try {
    const { phone, credentialId } = req.body;
    const [[user]] = await db.execute(
      'SELECT u.*, w.credential_id FROM users u LEFT JOIN webauthn_credentials w ON u.id=w.user_id WHERE u.phone=? AND w.credential_id=?',
      [phone, credentialId]
    );
    if (!user) return res.status(401).json({ message: 'احراز هویت ناموفق' });
    if (user.status !== 'active') return res.status(403).json({ message: 'حساب شما غیرفعال است' });
    
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: user.id, role: user.role, context: 'shop' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    
    res.json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/webauthn ── disable biometric
router.delete('/', auth, async (req, res) => {
  try {
    await db.execute('DELETE FROM webauthn_credentials WHERE user_id=?', [req.user.id]);
    await db.execute('UPDATE users SET webauthn_enabled=0 WHERE id=?', [req.user.id]);
    res.json({ message: 'اثر انگشت غیرفعال شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/webauthn/status ── check if biometric enabled
router.get('/status', auth, async (req, res) => {
  try {
    const [[user]] = await db.execute('SELECT webauthn_enabled FROM users WHERE id=?', [req.user.id]);
    const [creds] = await db.execute('SELECT id,device_name,created_at FROM webauthn_credentials WHERE user_id=?', [req.user.id]);
    res.json({ enabled: !!user?.webauthn_enabled, credentials: creds });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
