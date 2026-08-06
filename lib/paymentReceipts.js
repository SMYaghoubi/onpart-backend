const path = require('path');

const RECEIPT_PATTERN = /^receipt_\d+(?:_[a-f0-9]+)?\.(?:jpe?g|png|webp|pdf)$/i;
const MIME_BY_EXTENSION = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.pdf': 'application/pdf'
});

function isAllowedReceiptUpload(filename, mimetype) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return Boolean(MIME_BY_EXTENSION[ext] && MIME_BY_EXTENSION[ext] === String(mimetype || '').toLowerCase());
}

function canReadReceipt(user, payment) {
  if (!user || !payment) return false;
  return ['admin','partner'].includes(user.role) || Number(payment.user_id) === Number(user.id);
}

function resolveReceiptPath(uploadPath, filename) {
  const name = String(filename || '');
  if (!RECEIPT_PATTERN.test(name) || path.basename(name) !== name) return null;
  const root = path.resolve(uploadPath || './uploads');
  const resolved = path.resolve(root, name);
  if (path.dirname(resolved) !== root) return null;
  return resolved;
}

function receiptMime(filename) {
  return MIME_BY_EXTENSION[path.extname(String(filename || '')).toLowerCase()] || null;
}

module.exports = { RECEIPT_PATTERN, MIME_BY_EXTENSION, isAllowedReceiptUpload, canReadReceipt, resolveReceiptPath, receiptMime };