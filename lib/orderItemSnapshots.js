const fs = require('node:fs');
const path = require('node:path');
const states = new WeakMap();
const statements = fs.readFileSync(path.join(__dirname,'../migrations/023_order_item_supplier_snapshot.sql'),'utf8').split(';').map(sql=>sql.trim()).filter(Boolean);

function orderItemSnapshotSchema(db) {
  if (states.has(db)) return states.get(db);
  let ready, status='pending';
  const ensure = () => ready ||= (async () => {
    const conn = await db.getConnection();
    let locked = false;
    try {
      const [[row]] = await conn.query("SELECT GET_LOCK(CONCAT('onpart:orders:',LEFT(SHA2(DATABASE(),256),40)),10) acquired");
      if (!Number(row.acquired)) throw new Error('Order supplier snapshot schema is busy');
      locked = true;
      // SET/PREPARE/EXECUTE must run on the same connection, outside order transactions.
      for (const sql of statements) await conn.query(sql);
      status='ok';
    } finally {
      try { if (locked) await conn.query("SELECT RELEASE_LOCK(CONCAT('onpart:orders:',LEFT(SHA2(DATABASE(),256),40)))"); }
      finally { conn.release(); }
    }
  })().catch(error => { ready=undefined;status='unavailable';throw error; });
  ensure.status = () => status;
  states.set(db,ensure);
  return ensure;
}

function itemSnapshot(product, previous) {
  if (previous) return {
    supplierId:previous.supplier_id || null, priceKnown:Number(previous.supplier_price_known) === 1 ? 1 : 0,
    costPrice:previous.cost_price, code:previous.snapshot_code, name:previous.snapshot_name,
    brand:previous.snapshot_brand, car:previous.car_name
  };
  const supplierId = Number.isSafeInteger(Number(product.supplier_id)) && Number(product.supplier_id)>0 ? Number(product.supplier_id) : null;
  return {
    supplierId, priceKnown:supplierId && product.supplier_cost_price != null ? 1 : 0,
    costPrice:product.cost_price, code:product.code || null, name:product.description || null,
    brand:product.brand || null, car:product.car || null
  };
}

async function insertOrderItem(conn, orderId, productId, quantity, price, discount, total, snapshot) {
  await conn.execute(
    `INSERT INTO order_items (order_id,product_id,car_name,quantity,price,cost_price,total,discount,
      supplier_id,supplier_price_known,snapshot_code,snapshot_name,snapshot_brand) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [orderId,productId,snapshot.car ?? null,quantity,price,snapshot.costPrice,total,discount,
      snapshot.supplierId,snapshot.priceKnown,snapshot.code ?? null,snapshot.name ?? null,snapshot.brand ?? null]
  );
}

module.exports = { orderItemSnapshotSchema, itemSnapshot, insertOrderItem };

