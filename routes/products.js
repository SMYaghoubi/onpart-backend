const router = require('express').Router();
const db     = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');
const { normalizeBulkProductUpdate } = require('../lib/productBulkUpdate');
const { bulkUpdateProducts } = require('../lib/bulkProductsService');
const { broadcastUserDataChanged } = require('../lib/userNotifications');
const { parseAvailability, stockForAvailability } = require('../lib/productAvailability');
const { normalizeProductCode, productCodeSqlExpression } = require('../lib/productCode');
const { safelyRemoveProduct, safelyRemoveProducts } = require('../lib/productRemoval');

// ── GET /api/products ── (public)
router.get('/', (req,res,next)=>req.query.admin==='1'?adminAuth(req,res,next):next(), async (req, res) => {
  try {
    const { search, car, brand, category, page = 1, limit = 50, admin } = req.query;
    const offset = (page - 1) * limit;
    let where = ['p.status="active"'];
    const params = [];

    if (search) { const normalizedCode=normalizeProductCode(search); where.push(`(p.description LIKE ? OR ${productCodeSqlExpression('p.code')} LIKE ?)`); params.push(`%${search}%`, `%${normalizedCode}%`); }
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

    const products=rows.map(row=>{
      const available=Number(row.stock)>0;
      if(admin==='1'){const {stock,min_stock,...managementProduct}=row;return {...managementProduct,available}}
      return {...row,available};
    });
    res.json({ products, total: count[0].total, page: Number(page), limit: Number(limit) });
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
router.patch('/bulk', adminAuth, async (req, res) => {
  let normalized;
  try { normalized=normalizeBulkProductUpdate(req.body.ids,req.body.fields); }
  catch(error){return res.status(400).json({message:error.message})}
  try {
    const result=await bulkUpdateProducts(db,normalized);
    broadcastUserDataChanged('product','bulk-updated');
    res.json({message:'ویرایش گروهی محصولات انجام شد',...result});
  } catch(error) {
    if(!error.status)console.error('Bulk product update error:',error.message);
    res.status(error.status||500).json({message:error.status?error.message:'خطا در ویرایش گروهی محصولات'});
  }
});
router.post('/', adminAuth, async (req, res) => {
  try {
    if(Object.prototype.hasOwnProperty.call(req.body,'stock')) return res.status(400).json({message:'ورودی عددی موجودی پشتیبانی نمی‌شود؛ available را با مقدار درست/نادرست ارسال کنید'});
    const { code, description, car, brand, category, price, available, min_stock, has_flow, note, supplier_id } = req.body;
    const stock=stockForAvailability(0,parseAvailability(available).available);
    const [result] = await db.execute(
      'INSERT INTO products (code,description,car,brand,category,price,stock,min_stock,has_flow,note,supplier_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [code, description, car, brand, category, price, stock, min_stock || 5, has_flow || 0, note || '', supplier_id || null]
    );
    res.status(201).json({ id: result.insertId, message: 'محصول اضافه شد' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'کد محصول تکراری است' });
    res.status(err.status||500).json({ message: err.status?err.message:'خطای سرور' });
  }
});

// ── PUT /api/products/:id ── (admin)
router.put('/:id', adminAuth, async (req, res) => {
  try {
    if(Object.prototype.hasOwnProperty.call(req.body,'stock')) return res.status(400).json({message:'ورودی عددی موجودی پشتیبانی نمی‌شود؛ available را با مقدار درست/نادرست ارسال کنید'});
    const { description, car, brand, category, price, available, min_stock, has_flow, status, note, supplier_id } = req.body;
    const [[current]]=await db.execute('SELECT stock,min_stock FROM products WHERE id=?',[req.params.id]);
    if(!current)return res.status(404).json({message:'محصول یافت نشد'});
    const stock=stockForAvailability(current.stock,parseAvailability(available).available);
    await db.execute(
      'UPDATE products SET description=?,car=?,brand=?,category=?,price=?,stock=?,min_stock=?,has_flow=?,status=?,note=?,supplier_id=? WHERE id=?',
      [description, car, brand, category, price, stock, min_stock??current.min_stock, has_flow, status, note || '', supplier_id || null, req.params.id]
    );
    res.json({ message: 'محصول به‌روزرسانی شد' });
  } catch (err) {
    res.status(err.status||500).json({ message: err.status?err.message:'خطای سرور' });
  }
});

// ── DELETE /api/products/:id ── (admin)
// ── POST /api/products/bulk-delete ── (admin) - delete many products at once
router.post('/bulk-delete', adminAuth, async (req, res) => {
  try {
    const result=await safelyRemoveProducts(db,req.body.ids,req.user.id);
    res.status(result.failed?207:200).json(result);
  } catch (error) {
    if(!error.status)console.error('Bulk product removal error:',error.message);
    res.status(error.status||500).json({message:error.status?error.message:'حذف گروهی امن انجام نشد؛ دوباره تلاش کنید'});
  }
});
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const result=await safelyRemoveProduct(db,req.params.id,req.user.id);
    res.json(result);
  } catch (error) {
    if(!error.status)console.error('Product removal error:',error.message);
    res.status(error.status||500).json({message:error.status?error.message:'حذف امن محصول انجام نشد؛ دوباره تلاش کنید'});
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
        const normalizedCode=normalizeProductCode(code);
        if (!normalizedCode || !p.description) { failed++; errors.push(`${code||'بدون کد'}: کد و شرح الزامی است`); continue; }
        if(Object.prototype.hasOwnProperty.call(p,'stock')) throw new Error('ستون/فیلد موجودی عددی پذیرفته نیست؛ وضعیت موجودی را ارسال کنید');
        const available=parseAvailability(p.available).available;
        const [existing] = await db.execute(`SELECT id,stock FROM products WHERE ${productCodeSqlExpression('code')}=?`, [normalizedCode]);
        if (existing.length) {
          const stock=stockForAvailability(existing[0].stock,available);
          await db.execute(
            'UPDATE products SET description=?,car=?,brand=?,category=?,price=?,stock=?,min_stock=?,has_flow=? WHERE id=?',
            [p.description, p.car||'', p.brand||'', p.category||'', p.price||0, stock, p.min_stock||5, p.has_flow?1:0, existing[0].id]
          );
          updated++;
        } else {
          const stock=stockForAvailability(0,available);
          await db.execute(
            'INSERT INTO products (code,description,car,brand,category,price,stock,min_stock,has_flow) VALUES (?,?,?,?,?,?,?,?,?)',
            [code, p.description, p.car||'', p.brand||'', p.category||'', p.price||0, stock, p.min_stock||5, p.has_flow?1:0]
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
