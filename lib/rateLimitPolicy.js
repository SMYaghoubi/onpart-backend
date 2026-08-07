const crypto = require('crypto');

function normalizeIdentifier(value) {
  return String(value ?? '')
    .replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .trim().toLowerCase().slice(0, 160);
}
function getIdentifier(req) {
  const body = req.body || {};
  return normalizeIdentifier(body.username || body.phone || body.mobile || body.email || 'anonymous');
}
function rateLimitKey(scope, req, includeIdentifier = true) {
  const identifier = includeIdentifier ? getIdentifier(req) : '';
  const material = scope + '|' + (req.ip || req.socket?.remoteAddress || 'unknown') + '|' + identifier;
  return crypto.createHash('sha256').update(material).digest('hex');
}
function retryAfterSeconds(req, windowMs) {
  const reset = req.rateLimit?.resetTime;
  if (reset instanceof Date) return Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000));
  return Math.max(1, Math.ceil(windowMs / 1000));
}
function rateLimitHandler(windowMs) {
  return (req, res) => {
    const seconds = retryAfterSeconds(req, windowMs);
    res.setHeader('Retry-After', String(seconds));
    res.status(429).json({
      message: 'تعداد تلاش‌های ورود زیاد است. لطفاً ' + seconds + ' ثانیه دیگر دوباره تلاش کنید.',
      retry_after: seconds
    });
  };
}
module.exports = { normalizeIdentifier, getIdentifier, rateLimitKey, retryAfterSeconds, rateLimitHandler };