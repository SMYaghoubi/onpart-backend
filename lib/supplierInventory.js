const fs = require('node:fs');
const path = require('node:path');
const { parseAvailability, stockForAvailability } = require('./productAvailability');
const { normalizeProductCode } = require('./productCode');

const schemaStatements = fs.readFileSync(path.join(__dirname, '../migrations/021_supplier_inventory.sql'), 'utf8')
  .split(';').map(statement => statement.trim()).filter(Boolean);

const schemaStates = new WeakMap();

function supplierInventorySchema(db) {
  if (schemaStates.has(db)) return schemaStates.get(db);
  let ready;
  let status = 'pending';
  function ensureSchema() {
    if (!ready) {
      ready = (async () => {
        for (const statement of schemaStatements) await db.query(statement);
        status = 'ok';
      })().catch(error => {
        ready = undefined;
        status = 'unavailable';
        throw error;
      });
    }
    return ready;
  }
  ensureSchema.status = () => status;
  schemaStates.set(db,ensureSchema);
  return ensureSchema;
}

function parseQuantity(value) {
  if (value == null || value === '') return null;
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value).trim())) {
    throw new Error('تعداد موجودی باید عدد صحیح و صفر یا بیشتر باشد');
  }
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity > 2147483647) throw new Error('تعداد موجودی نامعتبر است');
  return quantity;
}

function parseSupplierPrice(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value).trim())) {
    throw new Error('قیمت همکاری به تومان نامعتبر است');
  }
  const price = Number(value);
  if (!Number.isSafeInteger(price) || price > Math.floor(Number.MAX_SAFE_INTEGER / 11)) {
    throw new Error('قیمت همکاری به تومان نامعتبر است');
  }
  return price;
}

function proposedInventory(raw, product) {
  const quantity = parseQuantity(raw.quantity);
  const oldQuantity = product?.quantity == null ? null : Number(product.quantity);
  const currentAvailable = Boolean(Number(product?.supplier_available ?? product?.stock));
  let available = raw.available == null || raw.available === ''
    ? null : parseAvailability(raw.available).available;
  const effectiveQuantity = quantity ?? oldQuantity;
  if (available === true && effectiveQuantity === 0) throw new Error('برای فعال کردن کالا، تعداد موجودی بیشتر از صفر وارد کنید');
  if (quantity === 0) available = false;
  return {
    quantity: quantity !== oldQuantity ? quantity : null,
    stock: available != null && (!product || available !== currentAvailable)
      ? stockForAvailability(product?.stock, available) : null
  };
}

function normalizeNewProduct(raw, allowedBrands) {
  const code = typeof raw.code === 'string' ? raw.code.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const brand = typeof raw.brand === 'string' ? raw.brand.trim() : '';
  if (code.length > 50 || !normalizeProductCode(code)) throw new Error('کد روی قطعه یا بسته‌بندی نامعتبر است');
  if (!description || description.length > 255) throw new Error('نام محصول را وارد کنید');
  if (!brand || !allowedBrands.has(brand)) throw new Error('برند کالا را از برندهای مجاز انتخاب کنید');
  const inventory = proposedInventory(raw, null);
  return { code, description, brand, price: parseSupplierPrice(raw.supplier_price),
    quantity: inventory.quantity, available: inventory.stock == null || inventory.stock > 0 };
}

async function saveSupplierInventory(conn, supplierId, productId, { quantity, price, available, code = null }) {
  await conn.execute(
    `INSERT INTO supplier_inventory (supplier_id,product_id,quantity,supplier_price,available,manufacturer_code)
     VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
       quantity=COALESCE(VALUES(quantity),quantity),
       supplier_price=COALESCE(VALUES(supplier_price),supplier_price),
       available=COALESCE(VALUES(available),available),
       manufacturer_code=COALESCE(VALUES(manufacturer_code),manufacturer_code)`,
    [supplierId, productId, quantity ?? null, price ?? null, available ?? null, code]
  );
}

module.exports = { supplierInventorySchema, parseQuantity, parseSupplierPrice, proposedInventory,
  normalizeNewProduct, saveSupplierInventory };
