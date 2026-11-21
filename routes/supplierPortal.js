const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const SMS = require('../config/sms');
const { supplierAuth, adminAuth } = require('../middleware/auth');
const { createNotif } = require('../config/notif');
const { calculateFinalPrice, validateSupplierValues, isProductInAllowedBrands } = require('../lib/supplierPricing');
const { supplierInventorySchema, parseSupplierPrice, parseQuantity, proposedInventory, normalizeNewProduct, saveSupplierInventory } = require('../lib/supplierInventory');
const { normalizeProductCode, productCodeSqlExpression } = require('../lib/productCode');
const { resolveAdminNotification, notifyAdminNotificationsChanged } = require('../lib/adminNotifications');
const { normalizeBrand, brandKey, mapSupplierBrands } = require('../lib/supplierBrands');
const { normalizeSupplierPhone, supplierPhoneSql } = require('../lib/supplierRegistration');

const MAX_ROWS = 2000;
const ensureInventorySchema = supplierInventorySchema(db);
async function inventoryReady(_req, res, next) {
  try { await ensureInventorySchema(); next(); }
  catch (error) { console.error('Supplier inventory schema:', error.message); res.status(503).json({ message:'موجودی تأمین‌کنندگان موقتاً در دسترس نیست' }); }
}
const cleanPhone = normalizeSupplierPhone;
const validId = value => Number.isInteger(Number(value)) && Number(value) > 0;

async function getSupplierByPhone(phone) {
  const [rows] = await db.execute(
    `SELECT id,company,name,mobile,status,portal_enabled
     FROM suppliers WHERE ${supplierPhoneSql}=?
     ORDER BY (status='approved' AND portal_enabled=1) DESC,(status='approved') DESC,id DESC LIMIT 1`, [phone]
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

router.get('/products', supplierAuth, inventoryReady, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT p.id,COALESCE(inv.manufacturer_code,p.code) code,p.description,p.car,p.brand,p.category,
              p.price,COALESCE(inv.available,(p.stock>0)) available,p.has_flow,p.updated_at,inv.quantity,inv.supplier_price
       FROM products p
       LEFT JOIN supplier_inventory inv ON inv.supplier_id=? AND inv.product_id=p.id
       WHERE p.status='active' AND EXISTS(
         SELECT 1 FROM supplier_product_scopes s
         WHERE s.supplier_id=? AND s.scope_type='brand' AND TRIM(s.scope_value)=TRIM(p.brand)
       ) ORDER BY p.brand,p.code`,
      [req.supplier.id, req.supplier.id]
    );
    const [scopes] = await db.execute(
      'SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand" ORDER BY scope_value',
      [req.supplier.id]
    );
    res.json({ products: rows, brands: scopes.map(row => row.scope_value.trim()) });
  } catch (err) {
    res.status(500).json({ message: 'خطا در دریافت محصولات مجاز' });
  }
});

router.get('/updates', supplierAuth, inventoryReady, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT b.id,b.status,b.source,b.submitted_at,b.reviewed_at,b.note,
        (SELECT COUNT(*) FROM supplier_update_items WHERE batch_id=b.id) +
        (SELECT COUNT(*) FROM supplier_new_product_requests WHERE batch_id=b.id) item_count
       FROM supplier_update_batches b
       WHERE b.supplier_id=? ORDER BY b.id DESC LIMIT 100`,
      [req.supplier.id]
    );
    res.json({ batches: rows });
  } catch (err) {
    res.status(500).json({ message: 'خطا در دریافت سوابق' });
  }
});

router.get('/updates/:id', supplierAuth, inventoryReady, async (req, res) => {
  try {
    const [[batch]] = await db.execute(
      'SELECT id,status,submitted_at,reviewed_at,note FROM supplier_update_batches WHERE id=? AND supplier_id=?',
      [req.params.id, req.supplier.id]
    );
    if (!batch) return res.status(404).json({ message:'درخواست یافت نشد' });
    const [items] = await db.execute(
      `SELECT COALESCE(inv.manufacturer_code,p.code) code,p.description,p.brand,CASE WHEN i.note IN ('stock_only','availability_only') THEN NULL ELSE i.supplier_price END supplier_price,
              q.quantity,i.status,(i.proposed_stock>0) available
       FROM supplier_update_items i JOIN products p ON p.id=i.product_id
       LEFT JOIN supplier_update_quantities q ON q.item_id=i.id
       LEFT JOIN supplier_inventory inv ON inv.product_id=p.id AND inv.supplier_id=?
       WHERE i.batch_id=? ORDER BY i.id`, [req.supplier.id, batch.id]
    );
    const [newItems] = await db.execute(
      'SELECT code,description,brand,supplier_price,quantity,available FROM supplier_new_product_requests WHERE batch_id=? ORDER BY id',
      [batch.id]
    );
    const [errors] = await db.execute('SELECT error_message FROM supplier_update_errors WHERE batch_id=? ORDER BY id', [batch.id]);
    res.json({ batch, items: [...items, ...newItems.map(row => ({ ...row, status:batch.status }))], errors });
  } catch (err) {
    res.status(500).json({ message:'خطا در دریافت جزئیات درخواست' });
  }
});

router.post('/updates', supplierAuth, inventoryReady, async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    const source = req.body.source === 'excel' ? 'excel' : 'manual';
    const filename = String(req.body.filename || '').slice(0, 255) || null;
    const items = req.body.items;
    const requestKey = req.body.request_key;
    if (requestKey != null && (typeof requestKey !== 'string' || !/^[0-9a-f-]{36}$/.test(requestKey))) {
      return res.status(400).json({ message:'شناسهٔ ارسال نامعتبر است' });
    }
    if (!Array.isArray(items) || !items.length || items.length > MAX_ROWS)
      return res.status(400).json({ message: `هر درخواست باید بین ۱ تا ${MAX_ROWS} ردیف داشته باشد` });

    // Serialize submissions from this supplier so a retried request can find its committed batch.
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM suppliers WHERE id=? FOR UPDATE', [req.supplier.id]);
    if (requestKey) {
      const [[accepted]] = await conn.execute(
        'SELECT batch_id,item_count FROM supplier_submission_keys WHERE supplier_id=? AND request_key=?',
        [req.supplier.id,requestKey]
      );
      if (accepted) {
        await conn.rollback();
        return res.json({ id:accepted.batch_id,rows:accepted.item_count,errors:0,message:'تغییرات برای بررسی ارسال شد' });
      }
    }
    const [scopes] = await conn.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand"', [req.supplier.id]);
    const brands = new Set(scopes.map(scope => String(scope.scope_value || '').trim()));
    const ids = [...new Set(items.filter(item => validId(item?.product_id)).map(item => Number(item.product_id)))];
    const byId = new Map();
    if (ids.length) {
      const [known] = await conn.execute(
        `SELECT p.id,p.code,p.brand,p.price,p.stock,inv.quantity,inv.supplier_price,inv.available supplier_available,inv.manufacturer_code
         FROM products p LEFT JOIN supplier_inventory inv ON inv.supplier_id=? AND inv.product_id=p.id
         WHERE p.status='active' AND p.id IN (${ids.map(() => '?').join(',')})`,
        [req.supplier.id, ...ids]
      );
      known.forEach(product => byId.set(Number(product.id), product));
    }

    const normalized = [], newProducts = [], errors = [];
    const seen = new Set(), seenNew = new Set();
    for (let index=0; index<items.length; index++) {
      const raw = items[index] || {};
      try {
        const originalCode = String(raw.code ?? '').trim();
        const code = normalizeProductCode(originalCode);
        if (!code) throw new Error('کد محصول نامعتبر است');
        if (Object.prototype.hasOwnProperty.call(raw,'stock')) throw new Error('برای تعداد موجودی از فیلد quantity استفاده کنید');
        if (raw.new_product === true && raw.product_id == null) {
          const newProduct = normalizeNewProduct(raw, brands);
          const identity = code + '\n' + brandKey(newProduct.brand);
          if (seenNew.has(identity)) throw new Error('کد و برند کالا در این لیست تکراری است');
          seenNew.add(identity);
          newProducts.push(newProduct);
          continue;
        }
        let product;
        if (raw.product_id != null) {
          product = byId.get(Number(raw.product_id));
          if (product && ![product.code, product.manufacturer_code].some(value => normalizeProductCode(value) === code)) {
            throw new Error('کد محصول با کالای انتخاب‌شده مطابقت ندارد');
          }
        } else {
          const [matching] = await conn.execute(
            `SELECT id,code,brand,price,stock FROM products WHERE ${productCodeSqlExpression('code')}=? AND status="active"`, [code]
          );
          const authorized = matching.filter(value => isProductInAllowedBrands(value, brands));
          const possible = raw.brand ? authorized.filter(value => brandKey(value.brand) === brandKey(raw.brand)) : authorized;
          if (possible.length > 1) throw new Error('این کد چند کالا دارد؛ کالای درست و برند آن را انتخاب کنید');
          if (!possible.length && matching.length) throw new Error('کد «' + originalCode + '» خارج از برندهای مجاز یا انتخاب‌شده شما است');
          product = possible[0];
        }
        if (!product) throw new Error('محصول با کد «' + originalCode + '» یافت نشد');
        if (!isProductInAllowedBrands(product, brands)) throw new Error('کالا خارج از برندهای مجاز شما است');
        if (seen.has(product.id)) throw new Error('این کالا در لیست چند بار وارد شده است');
        seen.add(product.id);
        const hasPrice = raw.supplier_price != null && raw.supplier_price !== '';
        const priorPrice = Number(product.supplier_price ?? product.price ?? 0);
        const supplierPrice = hasPrice ? parseSupplierPrice(raw.supplier_price) : priorPrice;
        const priceChanged = hasPrice && (supplierPrice !== priorPrice || (raw.product_id != null && product.supplier_price == null));
        const { stock, quantity } = proposedInventory(raw, product);
        if (priceChanged || stock != null || quantity != null) normalized.push({ product, supplierPrice, stock, quantity, priceChanged });
      } catch (error) {
        errors.push('ردیف ' + (index+1) + ': ' + error.message);
      }
    }
    if (errors.length || (!normalized.length && !newProducts.length)) {
      await conn.rollback();
      if (errors.length) return res.status(400).json({ message:'ردیف‌های مشخص‌شده را اصلاح کنید', errors });
      return res.status(400).json({ message:'هیچ تغییر واقعی نسبت به اطلاعات فعلی وجود ندارد' });
    }
    const [batchResult] = await conn.execute(
      'INSERT INTO supplier_update_batches (supplier_id,source,original_filename) VALUES (?,?,?)',
      [req.supplier.id, source, filename]
    );
    if (normalized.length) {
      const rows = normalized.map(row => [
        batchResult.insertId,row.product.id,row.supplierPrice,row.stock,row.product.price||0,
        row.product.supplier_available??row.product.stock??0,row.priceChanged?null:'stock_only'
      ]);
      await conn.query(
        `INSERT INTO supplier_update_items
         (batch_id,product_id,supplier_price,proposed_stock,previous_price,previous_stock,note) VALUES ?`, [rows]
      );
      const quantityByProduct = new Map(normalized.filter(row=>row.quantity!=null)
        .map(row=>[Number(row.product.id),row.quantity]));
      if (quantityByProduct.size) {
        const [inserted] = await conn.execute('SELECT id,product_id FROM supplier_update_items WHERE batch_id=?',[batchResult.insertId]);
        const quantities = inserted.filter(row=>quantityByProduct.has(Number(row.product_id)))
          .map(row=>[row.id,quantityByProduct.get(Number(row.product_id))]);
        await conn.query('INSERT INTO supplier_update_quantities (item_id,quantity) VALUES ?', [quantities]);
      }
    }
    if (newProducts.length) await conn.query(
      `INSERT INTO supplier_new_product_requests (batch_id,code,description,brand,supplier_price,quantity,available) VALUES ?`,
      [newProducts.map(row=>[batchResult.insertId,row.code,row.description,row.brand,row.price,row.quantity,Number(row.available)])]
    );
    const count = normalized.length + newProducts.length;
    if (requestKey) await conn.execute(
      'INSERT INTO supplier_submission_keys (supplier_id,request_key,batch_id,item_count) VALUES (?,?,?,?)',
      [req.supplier.id,requestKey,batchResult.insertId,count]
    );
    await conn.commit();
    try {
      await createNotif('supplier','به‌روزرسانی تأمین‌کننده '+batchResult.insertId,req.supplier.company+' تعداد '+count+' تغییر برای بررسی ارسال کرد','/admin/supplier-updates','supplier_batch',batchResult.insertId);
    } catch (notifError) {
      console.error('Supplier update admin notification failed:', notifError.message);
    }
    res.status(201).json({ id:batchResult.insertId, rows:count, errors:0, message:'تغییرات برای بررسی ارسال شد' });
  } catch (err) {
    try { await conn?.rollback(); } catch (_) {}
    console.error('Supplier update submit failed:', err.message);
    res.status(500).json({ message: 'خطا در ثبت تغییرات' });
  } finally { conn?.release(); }
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
    res.json({ brands:mapSupplierBrands(brands) });
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
    let brands = [...new Set((Array.isArray(req.body.brands)?req.body.brands:[]).map(normalizeBrand).filter(Boolean))].slice(0,200);
    const assignedCompany = req.body.assigned_company === true;
    if (brands.length) {
      const placeholders = brands.map(() => '?').join(',');
      const [existingBrands] = await conn.execute(
        `SELECT DISTINCT TRIM(brand) brand FROM products
         WHERE status='active' AND TRIM(brand) IN (${placeholders})`,
        brands
      );
      const available = new Map(mapSupplierBrands(existingBrands).map(row => [brandKey(row.brand),row.brand]));
      const invalid = brands.filter(brand => !available.has(brandKey(brand)));
      if (invalid.length) return res.status(400).json({ message:`برند نامعتبر است: ${invalid.join('، ')}` });
      brands = [...new Set(brands.map(brand => available.get(brandKey(brand))))];
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

router.get('/admin/updates', adminAuth, inventoryReady, async (req, res) => {
  try {
    const status = ['pending','approved','rejected'].includes(req.query.status) ? req.query.status : null;
    const params=[]; const conditions=['b.archived_at IS NULL']; if(status){conditions.push('b.status=?');params.push(status)} const where='WHERE '+conditions.join(' AND ');
    const [rows] = await db.execute(
      `SELECT b.*,s.company,s.name,s.mobile,
        (SELECT COUNT(*) FROM supplier_update_items WHERE batch_id=b.id) +
        (SELECT COUNT(*) FROM supplier_new_product_requests WHERE batch_id=b.id) item_count
       FROM supplier_update_batches b JOIN suppliers s ON s.id=b.supplier_id
       ${where} ORDER BY b.id DESC LIMIT 200`, params
    );
    res.json({ batches:rows });
  } catch (err) { res.status(500).json({ message:'خطای سرور' }); }
});

router.get('/admin/updates/:id', adminAuth, inventoryReady, async (req, res) => {
  try {
    const [[batch]] = await db.execute(
      'SELECT b.*,s.company,s.name FROM supplier_update_batches b JOIN suppliers s ON s.id=b.supplier_id WHERE b.id=?', [req.params.id]
    );
    if(!batch) return res.status(404).json({ message:'بسته تغییرات یافت نشد' });
    const [itemRows] = await db.execute(
      `SELECT i.*,p.code,p.description,p.brand,p.car,p.price current_price,p.stock current_stock,q.quantity proposed_quantity
       FROM supplier_update_items i JOIN products p ON p.id=i.product_id
       LEFT JOIN supplier_update_quantities q ON q.item_id=i.id
       WHERE i.batch_id=? ORDER BY i.id`, [req.params.id]
    );
    const items=itemRows.map(row=>{
      const { proposed_stock,previous_stock,current_stock,...item }=row;
      return {...item,proposed_available:proposed_stock==null?null:Number(proposed_stock)>0,previous_available:Number(previous_stock)>0,current_available:Number(current_stock)>0};
    });
    const [errors] = await db.execute('SELECT id,source_row,raw_code,error_message,status FROM supplier_update_errors WHERE batch_id=? ORDER BY id', [req.params.id]);
    const [newItems] = await db.execute('SELECT * FROM supplier_new_product_requests WHERE batch_id=? ORDER BY id', [batch.id]);
    res.json({ batch,items,errors,newItems });
  } catch (err) { res.status(500).json({ message:'خطای سرور' }); }
});

router.patch('/admin/updates/:batchId/items/:itemId', adminAuth, inventoryReady, async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    if (Object.prototype.hasOwnProperty.call(req.body,'stock')) return res.status(400).json({message:'از فیلد تعداد موجودی استفاده کنید'});
    await conn.beginTransaction();
    const [[current]] = await conn.execute(
      `SELECT i.id,i.supplier_price,i.note,i.status,b.status batch_status,p.stock,
              q.quantity proposed_quantity,inv.quantity
       FROM supplier_update_items i JOIN supplier_update_batches b ON b.id=i.batch_id
       JOIN products p ON p.id=i.product_id
       LEFT JOIN supplier_update_quantities q ON q.item_id=i.id
       LEFT JOIN supplier_inventory inv ON inv.product_id=p.id AND inv.supplier_id=b.supplier_id
       WHERE i.id=? AND i.batch_id=? FOR UPDATE`, [req.params.itemId,req.params.batchId]
    );
    if (!current || current.status!=='pending' || current.batch_status!=='pending') throw new Error('ردیف قابل ویرایش نیست یا قبلاً بررسی شده است');
    const price = parseSupplierPrice(req.body.supplier_price);
    const quantity = Object.hasOwn(req.body, 'quantity') ? parseQuantity(req.body.quantity) : current.proposed_quantity;
    let available = req.body.available;
    if (quantity === 0) available = false;
    if (available === true && (quantity ?? current.quantity) === 0) throw new Error('برای موجود شدن کالا، تعداد باید بیشتر از صفر باشد');
    const values = validateSupplierValues(price, available, current.stock);
    const note = price === Number(current.supplier_price) ? current.note : null;
    await conn.execute('UPDATE supplier_update_items SET supplier_price=?,proposed_stock=?,note=? WHERE id=?',
      [values.supplierPrice,values.stock,note,current.id]);
    if (quantity != null) await conn.execute(
      'INSERT INTO supplier_update_quantities (item_id,quantity) VALUES (?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)', [current.id, quantity]
    );
    else if (current.proposed_quantity != null) await conn.execute('DELETE FROM supplier_update_quantities WHERE item_id=?', [current.id]);
    await conn.commit();
    res.json({ message:'پیشنهاد ردیف ذخیره شد', available:values.available, quantity });
  } catch (err) {
    await conn?.rollback().catch(() => {});
    res.status(400).json({ message:err.message || 'مقادیر ردیف نامعتبر است' });
  } finally { conn?.release(); }
});

async function resolveNewProduct(conn, item) {
  const code = normalizeProductCode(item.code);
  const [matching] = await conn.execute(
    `SELECT p.id,p.code,p.brand,p.status FROM products p
     WHERE ${productCodeSqlExpression('p.code')}=? OR EXISTS (
       SELECT 1 FROM supplier_inventory si WHERE si.product_id=p.id AND ${productCodeSqlExpression('si.manufacturer_code')}=?
     ) FOR UPDATE`, [code, code]
  );
  const sameBrand = matching.filter(product => brandKey(product.brand) === brandKey(item.brand));
  if (sameBrand.length > 1) throw new Error('برای کد «' + item.code + '» چند کالای هم‌برند پیدا شد؛ کد دقیق را بررسی کنید');
  if (sameBrand[0] && sameBrand[0].status !== 'active') throw new Error('کالای «' + item.code + '» در کاتالوگ غیرفعال است');
  if (sameBrand[0]) return sameBrand[0].id;
  const suffix = '-S' + item.id;
  const catalogCode = matching.length ? item.code.slice(0, 50-suffix.length) + suffix : item.code;
  const [created] = await conn.execute(
    'INSERT INTO products (code,description,brand,price,stock) VALUES (?,?,?,0,0)',
    [catalogCode,item.description,item.brand]
  );
  return created.insertId;
}

router.post('/admin/updates/:id/approve', adminAuth, inventoryReady, async (req, res) => {
  let conn;
  try {
    conn = await db.getConnection();
    const defaultPercent=Number(req.body.markup_percent);
    const overrides=req.body.item_percentages && typeof req.body.item_percentages==='object' ? req.body.item_percentages : {};
    if(!Number.isFinite(defaultPercent)||defaultPercent<0||defaultPercent>1000) return res.status(400).json({ message:'درصد افزایش نامعتبر است' });
    await conn.beginTransaction();
    const [[batch]] = await conn.execute('SELECT * FROM supplier_update_batches WHERE id=? FOR UPDATE', [req.params.id]);
    if(!batch||batch.status!=='pending') throw new Error('این بسته قبلاً بررسی شده است');
    const [items] = await conn.execute(
      `SELECT i.*,p.brand,p.status product_status,p.price current_price,q.quantity proposed_quantity,inv.quantity
       FROM supplier_update_items i JOIN products p ON p.id=i.product_id
       LEFT JOIN supplier_update_quantities q ON q.item_id=i.id
       LEFT JOIN supplier_inventory inv ON inv.product_id=p.id AND inv.supplier_id=?
       WHERE i.batch_id=? AND i.status='pending' FOR UPDATE`, [batch.supplier_id,batch.id]
    );
    const [newItems] = await conn.execute('SELECT * FROM supplier_new_product_requests WHERE batch_id=? FOR UPDATE', [batch.id]);
    const [[errorCount]] = await conn.execute('SELECT COUNT(*) count FROM supplier_update_errors WHERE batch_id=?', [batch.id]);
    if ((!items.length && !newItems.length) || Number(errorCount.count)) throw new Error('ابتدا خطاهای فایل را اصلاح و یک بسته جدید ارسال کنید');
    const [scopeRows] = await conn.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand"', [batch.supplier_id]);
    const allowedBrands = new Set(scopeRows.map(row => String(row.scope_value || '').trim()));
    const appliedProductIds = new Set();
    for(const item of items){
      if (item.product_status !== 'active' || !isProductInAllowedBrands(item, allowedBrands)) throw new Error('دسترسی برند محصول ردیف ' + item.id + ' معتبر نیست');
      const override=overrides[item.id];
      const percent=override==null||override===''?defaultPercent:Number(override);
      if(!Number.isFinite(percent)||percent<0||percent>1000) throw new Error(`درصد ردیف ${item.id} نامعتبر است`);
      const priceChanged = !['stock_only','availability_only'].includes(item.note);
      const finalPrice = priceChanged ? calculateFinalPrice(item.supplier_price,percent) : Number(item.current_price);
      const quantity = item.proposed_quantity ?? item.quantity;
      if (Number(item.proposed_stock) > 0 && quantity === 0) throw new Error('تعداد موجودی ردیف «' + item.id + '» صفر است');
      if(item.proposed_stock==null){
        if (priceChanged) await conn.execute('UPDATE products SET price=?,supplier_id=? WHERE id=?',[finalPrice,batch.supplier_id,item.product_id]);
      }else if(Number(item.proposed_stock)>0){
        await conn.execute('UPDATE products SET price=?,stock=CASE WHEN stock>0 THEN stock ELSE 1 END,supplier_id=? WHERE id=?',[finalPrice,batch.supplier_id,item.product_id]);
      }else{
        await conn.execute('UPDATE products SET price=?,stock=0,supplier_id=? WHERE id=?',[finalPrice,batch.supplier_id,item.product_id]);
      }
      await saveSupplierInventory(conn, batch.supplier_id, item.product_id, {
        quantity:item.proposed_quantity, price:priceChanged ? item.supplier_price : null,
        available:item.proposed_stock == null ? null : Number(item.proposed_stock) > 0
      });
      appliedProductIds.add(Number(item.product_id));
      await conn.execute('UPDATE supplier_update_items SET final_price=?,status="approved" WHERE id=?',[finalPrice,item.id]);
    }
    for (const item of newItems) {
      if (!isProductInAllowedBrands(item, allowedBrands)) throw new Error('برند «' + item.brand + '» دیگر مجاز نیست');
      const id = await resolveNewProduct(conn,item);
      if (appliedProductIds.has(Number(id))) throw new Error('کالای «' + item.code + '» در همین بسته تکراری است');
      appliedProductIds.add(Number(id));
      const override = overrides['new-' + item.id];
      const percent = override == null || override === '' ? defaultPercent : Number(override);
      const price = calculateFinalPrice(item.supplier_price, percent);
      if (item.quantity === 0 && Number(item.available)) throw new Error('تعداد موجودی کالای جدید صفر است');
      await conn.execute('UPDATE products SET price=?,stock=?,supplier_id=? WHERE id=?', [price,Number(item.available) ? 1 : 0,batch.supplier_id,id]);
      await saveSupplierInventory(conn,batch.supplier_id,id,{ quantity:item.quantity,price:item.supplier_price,available:Boolean(Number(item.available)),code:item.code });
      await conn.execute('UPDATE supplier_new_product_requests SET product_id=? WHERE id=?',[id,item.id]);
    }
    await conn.execute('UPDATE supplier_update_batches SET status="approved",markup_percent=?,note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',
      [defaultPercent,String(req.body.note||'').slice(0,1000)||null,req.user.id,batch.id]);
    await resolveAdminNotification(conn,'supplier_batch',batch.id,'/admin/supplier-updates');
    await conn.commit();
    notifyAdminNotificationsChanged({ entity_type:'supplier_batch', entity_id:Number(batch.id), resolved:true });
    res.json({ message:`${items.length + newItems.length} محصول با موفقیت بررسی و اعمال شد` });
  } catch(err){
    try{await conn?.rollback();}catch(_){}
    res.status(400).json({ message:err.message||'خطا در تأیید تغییرات' });
  } finally { conn?.release(); }
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
    await resolveAdminNotification(conn,'supplier_batch',batch.id,'/admin/supplier-updates');
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
    await resolveAdminNotification(db,'supplier_batch',req.params.id,'/admin/supplier-updates');
    notifyAdminNotificationsChanged({ entity_type:'supplier_batch', entity_id:Number(req.params.id), resolved:true });
    res.json({ message:'تغییرات رد شد' });
  } catch(err){res.status(500).json({ message:'خطای سرور' });}
});

module.exports = router;
