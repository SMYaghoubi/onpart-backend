const path = require('node:path');

const DOCUMENT_TYPES = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf'
});

function isPrivateUploadPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (_) { return true; }
  const filename = path.posix.basename(path.posix.normalize(decoded.replace(/\\/g, '/')));
  return /^(?:receipt_|user_|credit_|supplierphoto_)/i.test(filename);
}

function documentType(filename) {
  const name = String(filename || '');
  if (!/^(?:user_|credit_)[a-z0-9_.-]+$/i.test(name) || path.basename(name) !== name) return null;
  return DOCUMENT_TYPES[path.extname(name).toLowerCase()] || null;
}

async function documentOwner(db, filename, user) {
  if (!documentType(filename)) return null;
  const management = ['admin', 'partner'].includes(user.role);
  const owner = management ? '' : 'AND id=?';
  const params = [filename, filename];
  if (!management) params.push(user.id);
  if (filename.startsWith('user_')) {
    const [[row]] = await db.execute(
      `SELECT id FROM users WHERE (id_card_image=? OR shop_image=?) ${owner} LIMIT 1`, params
    );
    return row || null;
  }
  const creditParams = [filename, filename, filename, filename];
  if (!management) creditParams.push(user.id);
  const [[row]] = await db.execute(
    `SELECT id FROM credit_requests WHERE (id_card_file=? OR guarantee_file=? OR job_file=? OR other_file=?) ${management ? '' : 'AND user_id=?'} LIMIT 1`,
    creditParams
  );
  return row || null;
}

module.exports = { documentType, documentOwner, isPrivateUploadPath };

