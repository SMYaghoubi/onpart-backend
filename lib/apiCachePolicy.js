function applyApiNoStore(req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (typeof res.vary === 'function') res.vary('Authorization');
  next();
}
module.exports = { applyApiNoStore };