const router = require('express').Router();
const db     = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');

// ── GET /api/products ── (public)
router.get('/', async (req, res) => {
  try {
    const { search, car, brand, category, page = 1, limit = 50, admin } = req.query;
    const offset = (page - 1) * limit;
    let where = ['p.status="active"'];
    const params = [];

    if (search) { where.push('(p.description LIKE ? OR p.code LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (car)      { where.push('p.car=?');      params.push(car); }
    if (brand)    { where.push('p.brand=?');    params.push(brand); }
    if (category) { where.push('p.category=?'); params.push(category); }

    const sql = admin === '1'
      ? `SELECT p.*, s.company as supplier_name FROM products p LEFT JOIN suppliers s ON p.supplier_id=s.id WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
      : `SELECT p.* FROM products p WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

    const [rows] = await db.execute(sql, params);

    const [count] = await db.execute(
      `SELECT COUNT(*) as total FROM products p WHERE ${where.join(' AND ')}`,
      params
    );

    res.json({ products: rows, total: count[0].total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('Products error:', err.message);
    res.status(500).json({ message: 'خطای سرور', error: err.message });
  }
});

// ── GET /api/products/:id ──
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM products WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'محصول یافت نشد' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/products ── (admin)
router.post('/', adminAuth, async (req, res) => {
  try {
    const { code, description, car, brand, category, price, stock, min_stock, has_flow, note, supplier_id } = req.body;
    const [result] = await db.execute(
      'INSERT INTO products (code,description,car,brand,category,price,stock,min_stock,has_flow,note,supplier_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [code, description, car, brand, category, price, stock || 0, min_stock || 5, has_flow || 0, note || '', supplier_id || null]
    );
    res.status(201).json({ id: result.insertId, message: 'محصول اضافه شد' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'کد محصول تکراری است' });
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PUT /api/products/:id ── (admin)
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { description, car, brand, category, price, stock, min_stock, has_flow, status, note, supplier_id } = req.body;
    await db.execute(
      'UPDATE products SET description=?,car=?,brand=?,category=?,price=?,stock=?,min_stock=?,has_flow=?,status=?,note=?,supplier_id=? WHERE id=?',
      [description, car, brand, category, price, stock, min_stock, has_flow, status, note || '', supplier_id || null, req.params.id]
    );
    res.json({ message: 'محصول به‌روزرسانی شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/products/:id ── (admin)
// ── POST /api/products/bulk-delete ── (admin) - delete many products at once
router.post('/bulk-delete', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'شناسه‌ای ارسال نشده' });
    const placeholders = ids.map(() => '?').join(',');
    const [result] = await db.execute(`DELETE FROM products WHERE id IN (${placeholders})`, ids);
    res.json({ message: 'محصولات حذف شدند', deleted: result.affectedRows });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

router.delete('/:id', adminAuth, async (req, res) => {
  try {
    // Actually delete so code can be reused
    await db.execute('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ message: 'محصول حذف شد' });
  } catch (err) {
    // If has order references, just deactivate
    await db.execute('UPDATE products SET status="inactive", code=CONCAT(code,"_deleted_",id) WHERE id=?', [req.params.id]);
    res.json({ message: 'محصول حذف شد' });
  }
});

// ── POST /api/products/bulk-import ── (admin) - import many products at once
router.post('/bulk-import', adminAuth, async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || !products.length)
      return res.status(400).json({ message: 'داده‌ای برای وارد کردن یافت نشد' });

    let imported = 0, updated = 0, failed = 0;
    const errors = [];

    for (const p of products) {
      try {
        const code = String(p.code).trim();
        if (!code || !p.description) { failed++; continue; }
        const [existing] = await db.execute('SELECT id FROM products WHERE TRIM(code)=?', [code]);
        if (existing.length) {
          await db.execute(
            'UPDATE products SET description=?,car=?,brand=?,category=?,price=?,stock=?,min_stock=?,has_flow=? WHERE id=?',
            [p.description, p.car||'', p.brand||'', p.category||'', p.price||0, p.stock||0, p.min_stock||5, p.has_flow?1:0, existing[0].id]
          );
          updated++;
        } else {
          await db.execute(
            'INSERT INTO products (code,description,car,brand,category,price,stock,min_stock,has_flow) VALUES (?,?,?,?,?,?,?,?,?)',
            [code, p.description, p.car||'', p.brand||'', p.category||'', p.price||0, p.stock||0, p.min_stock||5, p.has_flow?1:0]
          );
          imported++;
        }
      } catch (e) {
        failed++;
        errors.push(`${p.code}: ${e.message}`);
      }
    }

    res.json({ message: 'وارد کردن انجام شد', imported, updated, failed, errors: errors.slice(0,10) });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
