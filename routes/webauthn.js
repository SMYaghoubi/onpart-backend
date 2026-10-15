const router = require('express').Router();
const db = require('../config/database');
const { auth } = require('../middleware/auth');

// Legacy credentials were never verified with a signed WebAuthn assertion.
// Fail closed until a complete registration/authentication verifier is available.
// Keep account passwords, OTP login and existing credential records intact.
const unavailable = (_req,res) => res.status(410).json({
  code: 'BIOMETRIC_UNAVAILABLE',
  message: 'ورود اثرانگشتی فعلاً غیرفعال است؛ با رمز عبور یا کد پیامکی وارد شوید.'
});
router.get('/register-options', auth, unavailable);
router.post('/register', auth, unavailable);
router.post('/auth-options', unavailable);
router.post('/authenticate', unavailable);
router.get('/status', auth, (_req,res) => res.json({enabled:false,available:false,credentials:[]}));
router.delete('/', auth, async (req,res) => {
  try {
    await db.execute('DELETE FROM webauthn_credentials WHERE user_id=?',[req.user.id]);
    await db.execute('UPDATE users SET webauthn_enabled=0,webauthn_challenge=NULL WHERE id=?',[req.user.id]);
    res.json({message:'اثر انگشت غیرفعال شد'});
  } catch(error) { res.status(500).json({message:'خطای سرور'}); }
});
module.exports = router;
