const { sellerCodeSchema, ensureSellerCode } = require('./sellerCodes');
const { normalizeBrand, brandKey } = require('./supplierBrands');

function requestedBrands(value) {
  const brands = [...new Set(String(value || '').split(/[,،;؛\n\r]+/).map(normalizeBrand).filter(Boolean))];
  if (!brands.length || brands.length > 200 || brands.some(brand => brand.length > 150)) {
    throw Object.assign(new Error('برندهای اعلام‌شده فروشنده را پیش از تأیید بررسی و تکمیل کنید.'), { status:400 });
  }
  return brands;
}

function resolveRequestedBrands(value, catalog) {
  const labels = [...new Set(catalog.map(row => normalizeBrand(row.brand)).filter(Boolean))];
  const approved = [], invalid = [];
  for (const requested of requestedBrands(value)) {
    // Resolve spelling/spacing and unique bilingual labels; never use substring matching.
    const key = brandKey(requested).replace(/\s/g, '');
    const exact = labels.filter(label => brandKey(label).replace(/\s/g, '') === key);
    const matches = exact.length ? exact : labels.filter(label => label.split('|').some(alias => brandKey(alias).replace(/\s/g, '') === key));
    if (matches.length !== 1) invalid.push(requested);
    else approved.push(matches[0]);
  }
  if (invalid.length) throw Object.assign(new Error('این برندها در فهرست محصولات فعال، تطبیق یکتا ندارند: ' + invalid.join('، ') + '. پیش از تأیید، نام برندها را ویرایش یا برند را در محصولات سامانه تعریف کنید.'), { status:400 });
  return [...new Set(approved)];
}

async function approveSupplier(db, id, managerId, expectedBrands, confirmBrands = false) {
  await sellerCodeSchema(db)();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[supplier]] = await conn.execute('SELECT * FROM suppliers WHERE id=? FOR UPDATE', [id]);
    if (!supplier) throw Object.assign(new Error('درخواست یافت نشد'), { status:404 });
    // Repeated approval must not restore a brand permission later revoked by management.
    if (supplier.status === 'approved' && !confirmBrands) {
      supplier.seller_code = await ensureSellerCode(conn, id);
      await conn.commit();
      return { supplier, alreadyApproved:true };
    }
    if (confirmBrands && typeof expectedBrands !== 'string') {
      throw Object.assign(new Error('برندهای اعلام‌شده را ابتدا در صفحه بررسی مشاهده کنید.'), { status:400 });
    }
    if (expectedBrands !== undefined && expectedBrands !== (supplier.brands || '')) {
      throw Object.assign(new Error('برندهای این درخواست تغییر کرده‌اند؛ صفحه را تازه‌سازی و دوباره بررسی کنید.'), { status:409 });
    }
    const [catalog] = await conn.execute("SELECT DISTINCT TRIM(brand) brand FROM products WHERE status='active' AND brand IS NOT NULL AND TRIM(brand)<>''");
    const brands = resolveRequestedBrands(supplier.brands, catalog);
    const [[linkedUser]] = await conn.execute('SELECT u.id FROM users u WHERE TRIM(u.phone)=TRIM(?) AND NOT EXISTS(SELECT 1 FROM suppliers linked WHERE linked.user_id=u.id AND linked.id<>?) LIMIT 1', [supplier.mobile,id]);
    await conn.execute('DELETE FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand"', [id]);
    for (const brand of brands) await conn.execute('INSERT INTO supplier_product_scopes (supplier_id,scope_type,scope_value,created_by) VALUES (?,"brand",?,?)', [id,brand,managerId]);
    await conn.execute('UPDATE suppliers SET status="approved",portal_enabled=1,user_id=COALESCE(user_id,?) WHERE id=?', [linkedUser?.id || null,id]);
    supplier.seller_code = await ensureSellerCode(conn, id);
    await conn.commit();
    return { supplier, brands, alreadyApproved:false, brandsReapproved:supplier.status === 'approved' };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}

module.exports = { requestedBrands, resolveRequestedBrands, approveSupplier };

