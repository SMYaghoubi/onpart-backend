const router = require('express').Router();
const db     = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');
const { normalizeBulkProductUpdate } = require('../lib/productBulkUpdate');
const { bulkUpdateProducts } = require('../lib/bulkProductsService');
const { broadcastUserDataChanged } = require('../lib/userNotifications');
const { parseAvailability, stockForAvailability } = require('../lib/productAvailability');
const { normalizeProductCode, productCodeSqlExpression } = require('../lib/productCode');
const { normalizeProductText, productTextSqlExpression, mapProductFilterMetadata } = require('../lib/productSearch');
const { safelyRemoveProduct, safelyRemoveProducts } = require('../lib/productRemoval');
const { executeWithRetry, isTransientDatabaseError } = require('../lib/databaseRetry');

// ── GET /api/products ── (public)
router.get('/', (req,res,next)=>req.query.admin==='1'?adminAuth(req,res,next):next(), async (req, res) => {
  try {
    const { search, car, brand, category, page = 1, limit = 50, admin } = req.query;
    const offset = (page - 1) * limit;
    let where = ['p.status="active"'];
    const params = [];

    if (search) {
      const normalizedText=normalizeProductText(search,{compact:true}),normalizedCode=normalizeProductCode(search);
      where.push(`(${productCodeSqlExpression('p.code')} LIKE ? OR ${productTextSqlExpression('p.description')} LIKE ? OR ${productTextSqlExpression('p.brand')} LIKE ? OR ${productTextSqlExpression('p.category')} LIKE ?)`);
      params.push(`%${normalizedCode}%`,...Array(3).fill(`%${normalizedText}%`));
    }
    if (car)      { where.push(`${productTextSqlExpression('p.car')}=?`);      params.push(normalizeProductText(car,{compact:true})); }
    if (brand)    { where.push(`${productTextSqlExpression('p.brand')}=?`);    params.push(normalizeProductText(brand,{compact:true})); }
    if (category) { where.push(`${productTextSqlExpression('p.category')}=?`); params.push(normalizeProductText(category,{compact:true})); }

    const sql = admin === '1'
      ? `SELECT p.*, s.company as supplier_name FROM products p LEFT JOIN suppliers s ON p.supplier_id=s.id WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
      : `SELECT p.* FROM products p WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

    const [rows] = await executeWithRetry(db,sql,params);

    const [count] = await executeWithRetry(db,
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
    res.status(isTransientDatabaseError(err)?503:500).json({ message: 'دریافت محصولات موقتاً امکان‌پذیر نیست؛ دوباره تلاش کنید', code:'PRODUCTS_UNAVAILABLE' });
  }
});

// GET /api/products/metadata - distinct filter values from visible products only.
router.get('/metadata', async (_req,res)=>{
  try {
    const [rows]=await executeWithRetry(db,`
      SELECT DISTINCT 'car' type, TRIM(car) value FROM products WHERE status='active' AND car IS NOT NULL AND TRIM(car)<>''
      UNION ALL
      SELECT DISTINCT 'brand' type, TRIM(brand) value FROM products WHERE status='active' AND brand IS NOT NULL AND TRIM(brand)<>''
      UNION ALL
      SELECT DISTINCT 'category' type, TRIM(category) value FROM products WHERE status='active' AND category IS NOT NULL AND TRIM(category)<>''
    `);
    res.set('Cache-Control','no-store, private');
    res.json(mapProductFilterMetadata(rows));
  } catch(error) {
    console.error('Product metadata error:',error.message);
    res.status(isTransientDatabaseError(error)?503:500).json({message:'فیلترهای محصولات موقتاً در دسترس نیستند',code:'PRODUCT_METADATA_UNAVAILABLE'});
  }
});

// GET /api/products/:id
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
router.post('/bulk-import', adminAuth, async (req,res)=>{
  try{
    const {products}=req.body;if(!Array.isArray(products)||!products.length)return res.status(400).json({message:'داده‌ای برای وارد کردن یافت نشد'});
    let imported=0,updated=0,failed=0;const errors=[],supplierCache=new Map();
    for(const product of products){try{
      const code=String(product.code??'').trim(),normalizedCode=normalizeProductCode(code);if(!normalizedCode||!product.description)throw new Error('کد محصول و شرح محصول الزامی است');
      if(Object.prototype.hasOwnProperty.call(product,'stock'))throw new Error('موجودی عددی پذیرفته نیست؛ وضعیت موجودی را ارسال کنید');
      const available=parseAvailability(product.available).available,flowProvided=Object.prototype.hasOwnProperty.call(product,'has_flow');
      if(flowProvided&&!([0,1,true,false].includes(product.has_flow)))throw new Error('گردش فقط باید «دارد» یا «ندارد» باشد');
      const supplierProvided=Object.prototype.hasOwnProperty.call(product,'supplier_id');let requestedSupplier=null;
      if(supplierProvided&&product.supplier_id!==null&&product.supplier_id!==''){
        requestedSupplier=Number(product.supplier_id);if(!Number.isSafeInteger(requestedSupplier)||requestedSupplier<=0)throw new Error('تأمین‌کننده نامعتبر است');
        if(!supplierCache.has(requestedSupplier)){const [rows]=await db.execute('SELECT id FROM suppliers WHERE id=? AND status="approved"',[requestedSupplier]);supplierCache.set(requestedSupplier,Boolean(rows.length));}
        if(!supplierCache.get(requestedSupplier))throw new Error('تأمین‌کننده معتبر و تأییدشده نیست');
      }
      const [existing]=await db.execute(`SELECT id,stock,has_flow,supplier_id FROM products WHERE ${productCodeSqlExpression('code')}=?`,[normalizedCode]);
      if(existing.length){
        const current=existing[0],stock=stockForAvailability(current.stock,available),flow=flowProvided?(product.has_flow?1:0):Number(current.has_flow||0),supplierId=supplierProvided?requestedSupplier:current.supplier_id;
        await db.execute('UPDATE products SET description=?,car=?,brand=?,category=?,price=?,stock=?,min_stock=?,has_flow=?,supplier_id=? WHERE id=?',[product.description,product.car||'',product.brand||'',product.category||'',product.price||0,stock,product.min_stock||5,flow,supplierId,current.id]);updated++;
      }else{
        const stock=stockForAvailability(0,available);await db.execute('INSERT INTO products (code,description,car,brand,category,price,stock,min_stock,has_flow,supplier_id) VALUES (?,?,?,?,?,?,?,?,?,?)',[code,product.description,product.car||'',product.brand||'',product.category||'',product.price||0,stock,product.min_stock||5,flowProvided?(product.has_flow?1:0):0,supplierProvided?requestedSupplier:null]);imported++;
      }
    }catch(error){failed++;errors.push(`${product.code??'بدون کد'}: ${error.message}`)}}
    res.json({message:'وارد کردن انجام شد',imported,updated,failed,errors:errors.slice(0,10)});
  }catch(error){res.status(500).json({message:'خطای سرور'});}
});
module.exports = router;
