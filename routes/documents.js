const router = require('express').Router();
const db = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');
const { getUploadStorage } = require('../lib/uploadStorage');
const { documentType, documentOwner } = require('../lib/privateDocuments');

router.get('/:filename', (req, res, next) => req.query.admin === '1'
  ? adminAuth(req, res, next) : auth(req, res, next), async (req, res) => {
  try {
    const filename = req.params.filename;
    const type = documentType(filename);
    if (!type || !await documentOwner(db, filename, req.user)) {
      return res.status(404).json({ message: 'مدرک یافت نشد یا دسترسی ندارید' });
    }
    res.set({ 'Content-Type': type, 'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" });
    res.sendFile(filename, { root: getUploadStorage().path }, error => {
      if (error && !res.headersSent) res.status(error.status === 404 ? 404 : 500).json({ message: 'مدرک در دسترس نیست' });
    });
  } catch (error) {
    res.status(500).json({ message: 'دریافت مدرک انجام نشد' });
  }
});

module.exports = router;
