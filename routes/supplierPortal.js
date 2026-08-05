const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const SMS = require('../config/sms');
const { supplierAuth, adminAuth } = require('../middleware/auth');
const { createNotif } = require('../config/notif');
const { calculateFinalPrice, validateSupplierValues, isProductInAllowedBrands } = require('../lib/supplierPricing');
const { buildSupplierChange } = require('../lib/supplierChanges');
const { resolveAdminNotification, notifyAdminNotificationsChanged } = require('../lib/adminNotifications');

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
      `SELECT p.id,p.code,p.description,p.car,p.brand,p.category,p.price,p.stock,p.has_flow,p.updated_at
       FROM products p
       WHERE p.status='active' AND EXISTS(
         SELECT 1 FROM supplier_product_scopes s
         WHERE s.supplier_id=? AND s.scope_type='brand' AND TRIM(s.scope_value)=TRIM(p.brand)
       ) ORDER BY p.brand,p.code`,
      [req.supplier.id]
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
    const brands = new Set(scopes.filter(s => s.scope_type === 'brand').map(s => String(s.scope_value || '').trim()));
    const normalized = [];
    const seen = new Set();
    const errors = [];

    for (let index=0; index<items.length; index++) {
      const raw = items[index] || {};
      const code = String(raw.code || '').trim();
      if (!code) { errors.push('ردیف ' + (index+1) + ': کد محصول نامعتبر است'); continue; }
      if (seen.has(code)) { errors.push('ردیف ' + (index+1) + ': کد ' + code + ' تکراری است'); continue; }
      seen.add(code);
      const [[product]] = await conn.execute('SELECT id,code,brand,supplier_id,price,stock FROM products WHERE TRIM(code)=? AND status="active"', [code]);
      if (!product) { errors.push('ردیف ' + (index+1) + ': محصول ' + code + ' یافت نشد'); continue; }
      if (!isProductInAllowedBrands(product, brands)) { errors.push('ردیف ' + (index+1) + ': دسترسی محصول ' + code + ' داده نشده است'); continue; }
      try {
        const change = buildSupplierChange(product, raw.supplier_price, raw.stock);
        if (change) normalized.push({ product, supplierPrice:change.supplierPrice, stock:change.stock, priceChanged:change.priceChanged });
      } catch (validationError) {
        errors.push('ردیف ' + (index+1) + ': ' + validationError.message);
      }
    }
    if (!normalized.length && !errors.length) return res.status(400).json({ message:'هیچ تغییر واقعی نسبت به اطلاعات فعلی وجود ندارد' });
    await conn.beginTransaction();
    const [batchResult] = await conn.execute(
      'INSERT INTO supplier_update_batches (supplier_id,source,original_filename) VALUES (?,?,?)',
      [req.supplier.id, source, filename]
    );
    for (const error of errors) {
      await conn.execute(
        'INSERT INTO supplier_update_errors (batch_id,error_message) VALUES (?,?)',
        [batchResult.insertId, String(error).slice(0,1000)]
      );
    }
    for (const row of normalized) {
      await conn.execute(
        `INSERT INTO supplier_update_items
         (batch_id,product_id,supplier_price,proposed_stock,previous_price,previous_stock,note)
         VALUES (?,?,?,?,?,?,?)`,
        [batchResult.insertId,row.product.id,row.supplierPrice,row.stock,row.product.price||0,row.product.stock||0,row.priceChanged?null:'stock_only']
      );
    }
    await conn.commit();
    try {
      await createNotif('supplier','به‌روزرسانی تأمین‌کننده #'+batchResult.insertId,req.supplier.company+' تعداد '+normalized.length+' تغییر برای بررسی ارسال کرد','/admin/supplier-updates.html','supplier_batch',batchResult.insertId);
    } catch (notifError) {
      console.error('Supplier update admin notification failed:', notifError.message);
    }
    res.status(201).json({ id:batchResult.insertId, rows:normalized.length, errors:errors.length, message:'تغییرات برای بررسی ارسال شد' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('Supplier update submit failed:', err.message);
    res.status(500).json({ message: 'خطا در ثبت تغییرات' });
  } finally { conn.release(); }
});

// Admin/marketer: list available scope values.
router.get('/admin/scope-options', adminAuth, async (req, res) => {
  try {
    const [brands] = await db.execute(
      `SELECT TRIM(brand) brand, COUNT(*) product_count
       FROM products
       WHERE status='active' AND brand IS NOT NULL AND TRIM(brand)<>''
       GROUP BY TRIM(brand)
       ORDER BY TRIM(brand)`
    );
    res.json({ brands });
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
    if (brands.length) {
      const placeholders = brands.map(() => '?').join(',');
      const [existingBrands] = await conn.execute(
        `SELECT DISTINCT TRIM(brand) brand FROM products
         WHERE status='active' AND TRIM(brand) IN (${placeholders})`,
        brands
      );
      const existing = new Set(existingBrands.map(row => row.brand));
      const invalid = brands.filter(brand => !existing.has(brand));
      if (invalid.length) return res.status(400).json({ message:`برند نامعتبر است: ${invalid.join('، ')}` });
    }
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
    const params=[]; const conditions=['b.archived_at IS NULL']; if(status){conditions.push('b.status=?');params.push(status)} const where='WHERE '+conditions.join(' AND ');
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
    const [errors] = await db.execute('SELECT id,source_row,raw_code,error_message,status FROM supplier_update_errors WHERE batch_id=? ORDER BY id', [req.params.id]);
    res.json({ batch,items,errors });
  } catch (err) { res.status(500).json({ message:'خطای سرور' }); }
});

router.patch('/admin/updates/:batchId/items/:itemId', adminAuth, async (req, res) => {
  try {
    const values = validateSupplierValues(req.body.supplier_price, req.body.stock);
    const [result] = await db.execute(
      'UPDATE supplier_update_items i JOIN supplier_update_batches b ON b.id=i.batch_id SET i.supplier_price=?,i.proposed_stock=?,i.note=IF(?=i.previous_price,"stock_only",NULL) WHERE i.id=? AND i.batch_id=? AND i.status="pending" AND b.status="pending"',
      [values.supplierPrice,values.stock,values.supplierPrice,req.params.itemId,req.params.batchId]
    );
    if (!result.affectedRows) return res.status(409).json({ message:'ردیف قابل ویرایش نیست یا قبلاً بررسی شده است' });
    res.json({ message:'پیشنهاد ردیف ذخیره شد' });
  } catch (err) {
    res.status(400).json({ message:err.message || 'مقادیر ردیف نامعتبر است' });
  }
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
    const [items] = await conn.execute('SELECT i.*,p.brand,p.status product_status FROM supplier_update_items i JOIN products p ON p.id=i.product_id WHERE i.batch_id=? FOR UPDATE', [batch.id]);
    const [[errorCount]] = await conn.execute('SELECT COUNT(*) count FROM supplier_update_errors WHERE batch_id=?', [batch.id]);
    if (!items.length || Number(errorCount.count)) throw new Error('ابتدا خطاهای فایل را اصلاح و یک بسته جدید ارسال کنید');
    const [scopeRows] = await conn.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand"', [batch.supplier_id]);
    const allowedBrands = new Set(scopeRows.map(row => String(row.scope_value || '').trim()));
    for(const item of items){
      if (item.product_status !== 'active' || !isProductInAllowedBrands(item, allowedBrands)) throw new Error('دسترسی برند محصول ردیف ' + item.id + ' معتبر نیست');
      validateSupplierValues(item.supplier_price, item.proposed_stock);
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
    await resolveAdminNotification(conn,'supplier_batch',batch.id,'/admin/supplier-updates.html');
    await conn.commit();
    notifyAdminNotificationsChanged({ entity_type:'supplier_batch', entity_id:Number(batch.id), resolved:true });
    res.json({ message:`${items.length} محصول با موفقیت به‌روزرسانی شد` });
  } catch(err){
    try{await conn.rollback();}catch(_){}
    res.status(400).json({ message:err.message||'خطا در تأیید تغییرات' });
  } finally { conn.release(); }
});

router.delete('/admin/updates/:id', adminAuth, async (req, res) => {
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[batch]]=await conn.execute('SELECT id,status FROM supplier_update_batches WHERE id=? FOR UPDATE',[req.params.id]);
    if(!batch){await conn.rollback();return res.status(404).json({message:'درخواست یافت نشد'})}
    if(batch.status==='approved'){
      await conn.execute('UPDATE supplier_update_batches SET archived_at=NOW(),archived_by=? WHERE id=?',[req.user.id,batch.id]);
    }else{
      await conn.execute('DELETE FROM supplier_update_batches WHERE id=?',[batch.id]);
    }
    await resolveAdminNotification(conn,'supplier_batch',batch.id,'/admin/supplier-updates.html');
    await conn.commit();
    notifyAdminNotificationsChanged({ entity_type:'supplier_batch', entity_id:Number(batch.id), resolved:true });
    res.json({message:batch.status==='approved'?'درخواست تأییدشده بایگانی شد':'درخواست حذف شد',archived:batch.status==='approved'});
  } catch(err){try{await conn.rollback()}catch(_){}res.status(500).json({message:'خطا در حذف درخواست'})}
  finally{conn.release()}
});
router.post('/admin/updates/:id/reject', adminAuth, async (req, res) => {
  try {
    const [result]=await db.execute(
      'UPDATE supplier_update_batches SET status="rejected",note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=? AND status="pending"',
      [String(req.body.note||'').slice(0,1000)||null,req.user.id,req.params.id]
    );
    if(!result.affectedRows) return res.status(400).json({ message:'این بسته قابل رد نیست' });
    await db.execute('UPDATE supplier_update_items SET status="rejected" WHERE batch_id=?',[req.params.id]);
    await resolveAdminNotification(db,'supplier_batch',req.params.id,'/admin/supplier-updates.html');
    notifyAdminNotificationsChanged({ entity_type:'supplier_batch', entity_id:Number(req.params.id), resolved:true });
    res.json({ message:'تغییرات رد شد' });
  } catch(err){res.status(500).json({ message:'خطای سرور' });}
});

module.exports = router;
