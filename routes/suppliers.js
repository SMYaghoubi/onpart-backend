const router = require('express').Router();
const db     = require('../config/database');
const { adminAuth } = require('../middleware/auth');
const { createNotif } = require('../config/notif');
const SMS    = require('../config/sms');

// ── POST /api/suppliers ── (public form OR admin manual add)
router.post('/', async (req, res) => {
  try {
    const {
      company, type, name, mobile, city, province, address,
      email, phone, website, reg_number, year,
      inventory, shipping, description, categories, brands
    } = req.body;

    if (!company || !name || !mobile || !city)
      return res.status(400).json({ message: 'اطلاعات ناقص است' });

    const [result] = await db.execute(
      `INSERT INTO suppliers (company,type,name,mobile,city,province,address,email,phone,website,reg_number,year,inventory,shipping,description,categories,brands,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [company,type||'',name,mobile,city,province||'',address||'',email||'',phone||'',website||'',reg_number||'',year||'',inventory||'',shipping||'',description||'',categories||'',brands||'', 'pending']
    );

    const trackId = result.insertId;

    // Only send registration SMS for public form submissions (not admin manual add)
    const isAdminAdd = req.headers.authorization;
    if (!isAdminAdd) {
      await SMS.supplierRegistered(mobile, name, trackId);
    }
    await createNotif('supplier', 'درخواست همکاری جدید', `${company} — ${name} — ${mobile}`, '/admin/partners');

    res.status(201).json({ id: trackId, message: 'درخواست همکاری ثبت شد' });
  } catch (err) {
    console.error('Supplier POST error:', err.message);
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PUT /api/suppliers/:id ── (admin edit)
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const {
      company, type, name, mobile, city, province, address,
      email, phone, brands, description
    } = req.body;

    await db.execute(
      `UPDATE suppliers SET company=?,type=?,name=?,mobile=?,city=?,province=?,address=?,email=?,phone=?,brands=?,description=? WHERE id=?`,
      [company, type||'', name, mobile, city, province||'', address||'', email||'', phone||'', brands||'', description||'', req.params.id]
    );

    res.json({ message: 'تامین‌کننده به‌روزرسانی شد' });
  } catch (err) {
    console.error('Supplier PUT error:', err.message);
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/suppliers/public-stats ── (public, no auth)
router.get('/public-stats', async (req, res) => {
  try {
    const [[supCount]] = await db.execute("SELECT COUNT(*) as cnt FROM suppliers WHERE status='approved'");
    const [brandRows] = await db.execute("SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand != ''");
    res.json({ suppliers: supCount.cnt, brands: brandRows.length });
  } catch (err) {
    res.json({ suppliers: 0, brands: 0 });
  }
});

// ── GET /api/suppliers ── (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM suppliers ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/suppliers/:id/approve ── (admin)
router.patch('/:id/approve', adminAuth, async (req, res) => {
  try {
    const [[s]] = await db.execute('SELECT * FROM suppliers WHERE id=?', [req.params.id]);
    if (!s) return res.status(404).json({ message: 'درخواست یافت نشد' });
    await db.execute('UPDATE suppliers SET status="approved" WHERE id=?', [req.params.id]);
    await SMS.supplierApproved(s.mobile, s.name, req.params.id);
    res.json({ message: 'درخواست تایید شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/suppliers/:id/reject ── (admin)
router.patch('/:id/reject', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const [[s]] = await db.execute('SELECT * FROM suppliers WHERE id=?', [req.params.id]);
    if (!s) return res.status(404).json({ message: 'درخواست یافت نشد' });
    await db.execute('UPDATE suppliers SET status="rejected", description=CONCAT(IFNULL(description,"")," | دلیل رد: ",?) WHERE id=?', [reason||'', req.params.id]);
    await SMS.supplierRejected(s.mobile, s.name, req.params.id, reason);
    res.json({ message: 'درخواست رد شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/suppliers/:id ── (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await db.execute('DELETE FROM suppliers WHERE id=?', [req.params.id]);
    res.json({ message: 'درخواست حذف شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
