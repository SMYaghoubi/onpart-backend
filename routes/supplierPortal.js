const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const SMS = require('../config/sms');
const { supplierAuth, adminAuth } = require('../middleware/auth');
const { createNotif } = require('../config/notif');
const { calculateFinalPrice } = require('../lib/supplierPricing');

const MAX_ROWS = 2000;
const cleanPhone = value => String(value || '').replace(/\D/g, '');
const validId = value => Number.isInteger(Number(value)) && Number(value) > 0;

async function getSupplierByPhone(phone) {
  const [rows] = await db.execute(
    `SELECT id,company,name,mobile,status,portal_enabled
     FROM suppliers WHERE mobile=? ORDER BY id DESC LIMIT 1`, [phone]
  );
  return rows[0] || null;
}

router.post('/auth/send-otp', async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone);
    if (!/^09\d{9}$/.test(phone)) return res.status(400).json({ message: 'شماره موبایل نامعتبر است' });
    const supplier = await getSupplierByPhone(phone);
    if (!supplier || supplier.status !== 'approved' || !supplier.portal_enabled)
      return res.status(403).json({ message: 'حساب تأمین‌کننده هنوز توسط مدیریت فعال نشده است' });
    await SMS.sendOTP(phone);
    res.json({ message: 'کد ورود ارسال شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطا در ارسال کد ورود' });
  }
});

router.post('/auth/verify-otp', async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone);
    const code = String(req.body.code || '').trim();
    const supplier = await getSupplierByPhone(phone);
    if (!supplier || supplier.status !== 'approved' || !supplier.portal_enabled)
      return res.status(403).json({ message: 'دسترسی پنل فعال نیست' });
    if (!await SMS.verifyOTP(phone, code)) return res.status(400).json({ message: 'کد نامعتبر یا منقضی شده است' });
    const token = jwt.sign(
      { supplier_id: supplier.id, phone, role: 'supplier', name: supplier.company },
      process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );
    res.json({ token, supplier: { id:supplier.id, company:supplier.company, name:supplier.name, mobile:supplier.mobile } });
  } catch (err) {
    res.status(500).json({ message: 'خطا در ورود تأمین‌کننده' });
  }
});

router.get('/me', supplierAuth, (req, res) => res.json(req.supplier));

router.get('/products', supplierAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT p.id,p.code,p.description,p.car,p.brand,p.category,p.price,p.stock,p.updated_at
       FROM products p
       WHERE p.status='active' AND (
         (p.supplier_id=? AND EXISTS(
           SELECT 1 FROM supplier_product_scopes s
           WHERE s.supplier_id=? AND s.scope_type='assigned_company'
         )) OR EXISTS(
           SELECT 1 FROM supplier_product_scopes s
           WHERE s.supplier_id=? AND s.scope_type='brand' AND s.scope_value=p.brand
         )
       ) ORDER BY p.brand,p.code`,
      [req.supplier.id, req.supplier.id, req.supplier.id]
    );
    res.json({ products: rows });
  } catch (err) {
    res.status(500).json({ message: 'خطا در دریافت محصولات مجاز' });
  }
});

router.get('/updates', supplierAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT b.*,COUNT(i.id) item_count,
       SUM(i.status='approved') approved_count
       FROM supplier_update_batches b
       LEFT JOIN supplier_update_items i ON i.batch_id=b.id
       WHERE b.supplier_id=? GROUP BY b.id ORDER BY b.id DESC LIMIT 100`,
      [req.supplier.id]
    );
    res.json({ batches: rows });
  } catch (err) {
    res.status(500).json({ message: 'خطا در دریافت سوابق' });
  }
});

router.post('/updates', supplierAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const source = req.body.source === 'excel' ? 'excel' : 'manual';
    const filename = String(req.body.filename || '').slice(0, 255) || null;
    const items = req.body.items;
    if (!Array.isArray(items) || !items.length || items.length > MAX_ROWS)
      return res.status(400).json({ message: `فایل باید بین ۱ تا ${MAX_ROWS} ردیف داشته باشد` });

    const [scopes] = await conn.execute('SELECT scope_type,scope_value FROM supplier_product_scopes WHERE supplier_id=?', [req.supplier.id]);
    const brands = new Set(scopes.filter(s => s.scope_type === 'brand').map(s => s.scope_value));
    const assignedAllowed = scopes.some(s => s.scope_type === 'assigned_company');
    const normalized = [];
    const seen = new Set();
    const errors = [];

    for (let index=0; index<items.length; index++) {
      const raw = items[index] || {};
      const code = String(raw.code || '').trim();
      const supplierPrice = Number(raw.supplier_price);
      const stock = raw.stock === '' || raw.stock == null ? null : Number(raw.stock);
      if (!code || !Number.isInteger(supplierPrice) || supplierPrice < 0 || (stock != null && (!Number.isInteger(stock) || stock < 0))) {
        errors.push(`ردیف ${index+1}: کد، قیمت یا موجودی نامعتبر است`); continue;
      }
      if (seen.has(code)) { errors.push(`ردیف ${index+1}: کد ${code} تکراری است`); continue; }
      seen.add(code);
      const [[product]] = await conn.execute('SELECT id,code,brand,supplier_id,price,stock FROM products WHERE TRIM(code)=? AND status="active"', [code]);
      if (!product) { errors.push(`ردیف ${index+1}: محصول ${code} یافت نشد`); continue; }
      if (!(brands.has(product.brand) || (assignedAllowed && Number(product.supplier_id) === Number(req.supplier.id)))) {
        errors.push(`ردیف ${index+1}: دسترسی محصول ${code} داده نشده است`); continue;
      }
      normalized.push({ product, supplierPrice, stock });
    }
    if (errors.length) return res.status(400).json({ message: 'برخی ردیف‌ها معتبر نیستند', errors: errors.slice(0,50) });

    await conn.beginTransaction();
    const [batchResult] = await conn.execute(
      'INSERT INTO supplier_update_batches (supplier_id,source,original_filename) VALUES (?,?,?)',
      [req.supplier.id, source, filename]
    );
    for (const row of normalized) {
      await conn.execute(
        `INSERT INTO supplier_update_items
         (batch_id,product_id,supplier_price,proposed_stock,previous_price,previous_stock)
         VALUES (?,?,?,?,?,?)`,
        [batchResult.insertId,row.product.id,row.supplierPrice,row.stock,row.product.price||0,row.product.stock||0]
      );
    }
    await conn.commit();
    try {
      await createNotif('supplier', `به‌روزرسانی قیمت #${batchResult.insertId}`, `${req.supplier.company} تعداد ${normalized.length} تغییر برای بررسی ارسال کرد`, '/admin/supplier-updates.html');
    } catch (notifError) {
      console.error('Supplier update admin notification failed:', notifError.message);
    }
    res.status(201).json({ id:batchResult.insertId, rows:normalized.length, message:'تغییرات برای بررسی ارسال شد' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('Supplier update submit failed:', err.message);
    res.status(500).json({ message: 'خطا در ثبت تغییرات' });
  } finally { conn.release(); }
});

// Admin/marketer: list available scope values.
router.get('/admin/scope-options', adminAuth, async (req, res) => {
  try {
    const [brands] = await db.execute("SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL AND brand<>'' ORDER BY brand");
    res.json({ brands: brands.map(row => row.brand) });
  } catch (err) { res.status(500).json({ message:'خطای سرور' }); }
});

router.get('/admin/suppliers/:id/scopes', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT scope_type,scope_value FROM supplier_product_scopes WHERE supplier_id=?', [req.params.id]);
    res.json({ scopes:rows });
  } catch (err) { res.status(500).json({ message:'خطای سرور' }); }
});

router.put('/admin/suppliers/:id/scopes', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message:'شناسه نامعتبر است' });
    const brands = [...new Set((Array.isArray(req.body.brands)?req.body.brands:[]).map(v=>String(v).trim()).filter(Boolean))].slice(0,200);
    const assignedCompany = req.body.assigned_company === true;
    await conn.beginTransaction();
    await conn.execute('DELETE FROM supplier_product_scopes WHERE supplier_id=?', [req.params.id]);
    if (assignedCompany) await conn.execute(
      'INSERT INTO supplier_product_scopes (supplier_id,scope_type,scope_value,created_by) VALUES (?,"assigned_company","",?)',
      [req.params.id,req.user.id]
    );
    for (const brand of brands) await conn.execute(
      'INSERT INTO supplier_product_scopes (supplier_id,scope_type,scope_value,created_by) VALUES (?,"brand",?,?)',
      [req.params.id,brand,req.user.id]
    );
    await conn.execute('UPDATE suppliers SET portal_enabled=1 WHERE id=? AND status="approved"', [req.params.id]);
    await conn.commit();
    res.json({ message:'دسترسی پنل تأمین‌کننده ذخیره شد' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    res.status(500).json({ message:'خطا در ذخیره دسترسی‌ها' });
  } finally { conn.release(); }
});

router.get('/admin/updates', adminAuth, async (req, res) => {
  try {
    const status = ['pending','approved','rejected'].includes(req.query.status) ? req.query.status : null;
    const params=[]; const where=status?'WHERE b.status=?':''; if(status) params.push(status);
    const [rows] = await db.execute(
      `SELECT b.*,s.company,s.name,s.mobile,COUNT(i.id) item_count
       FROM supplier_update_batches b JOIN suppliers s ON s.id=b.supplier_id
       LEFT JOIN supplier_update_items i ON i.batch_id=b.id
       ${where} GROUP BY b.id ORDER BY b.id DESC LIMIT 200`, params
    );
    res.json({ batches:rows });
  } catch (err) { res.status(500).json({ message:'خطای سرور' }); }
});

router.get('/admin/updates/:id', adminAuth, async (req, res) => {
  try {
    const [[batch]] = await db.execute(
      'SELECT b.*,s.company,s.name FROM supplier_update_batches b JOIN suppliers s ON s.id=b.supplier_id WHERE b.id=?', [req.params.id]
    );
    if(!batch) return res.status(404).json({ message:'بسته تغییرات یافت نشد' });
    const [items] = await db.execute(
      `SELECT i.*,p.code,p.description,p.brand,p.car,p.price current_price,p.stock current_stock
       FROM supplier_update_items i JOIN products p ON p.id=i.product_id WHERE i.batch_id=? ORDER BY i.id`, [req.params.id]
    );
    res.json({ batch,items });
  } catch (err) { res.status(500).json({ message:'خطای سرور' }); }
});

router.post('/admin/updates/:id/approve', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const defaultPercent=Number(req.body.markup_percent);
    const overrides=req.body.item_percentages && typeof req.body.item_percentages==='object' ? req.body.item_percentages : {};
    if(!Number.isFinite(defaultPercent)||defaultPercent<0||defaultPercent>1000) return res.status(400).json({ message:'درصد افزایش نامعتبر است' });
    await conn.beginTransaction();
    const [[batch]] = await conn.execute('SELECT * FROM supplier_update_batches WHERE id=? FOR UPDATE', [req.params.id]);
    if(!batch||batch.status!=='pending') throw new Error('این بسته قبلاً بررسی شده است');
    const [items] = await conn.execute('SELECT * FROM supplier_update_items WHERE batch_id=? FOR UPDATE', [batch.id]);
    for(const item of items){
      const override=overrides[item.id];
      const percent=override==null||override===''?defaultPercent:Number(override);
      if(!Number.isFinite(percent)||percent<0||percent>1000) throw new Error(`درصد ردیف ${item.id} نامعتبر است`);
      const finalPrice=calculateFinalPrice(item.supplier_price,percent);
      if(item.proposed_stock==null){
        await conn.execute('UPDATE products SET price=?,supplier_id=? WHERE id=?',[finalPrice,batch.supplier_id,item.product_id]);
      }else{
        await conn.execute('UPDATE products SET price=?,stock=?,supplier_id=? WHERE id=?',[finalPrice,item.proposed_stock,batch.supplier_id,item.product_id]);
      }
      await conn.execute('UPDATE supplier_update_items SET final_price=?,status="approved" WHERE id=?',[finalPrice,item.id]);
    }
    await conn.execute('UPDATE supplier_update_batches SET status="approved",markup_percent=?,note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',
      [defaultPercent,String(req.body.note||'').slice(0,1000)||null,req.user.id,batch.id]);
    await conn.commit();
    res.json({ message:`${items.length} محصول با موفقیت به‌روزرسانی شد` });
  } catch(err){
    try{await conn.rollback();}catch(_){}
    res.status(400).json({ message:err.message||'خطا در تأیید تغییرات' });
  } finally { conn.release(); }
});

router.post('/admin/updates/:id/reject', adminAuth, async (req, res) => {
  try {
    const [result]=await db.execute(
      'UPDATE supplier_update_batches SET status="rejected",note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=? AND status="pending"',
      [String(req.body.note||'').slice(0,1000)||null,req.user.id,req.params.id]
    );
    if(!result.affectedRows) return res.status(400).json({ message:'این بسته قابل رد نیست' });
    await db.execute('UPDATE supplier_update_items SET status="rejected" WHERE batch_id=?',[req.params.id]);
    res.json({ message:'تغییرات رد شد' });
  } catch(err){res.status(500).json({ message:'خطای سرور' });}
});

module.exports = router;
