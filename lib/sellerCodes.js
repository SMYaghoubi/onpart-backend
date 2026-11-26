const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const initializers = new WeakMap();
const validSellerCode = value => /^OP-[1-9][0-9]{5}$/.test(String(value || ''));

function sellerCodeSchema(db) {
  if (initializers.has(db)) return initializers.get(db);
  let ready;
  const ensure = () => ready ||= db.query(fs.readFileSync(path.join(__dirname, '../migrations/025_supplier_seller_codes.sql'), 'utf8'))
    .catch(error => { ready = undefined; throw error; });
  initializers.set(db, ensure);
  return ensure;
}

// Call only after verifying this account is an approved supplier, or inside its approval transaction.
// Codes are immutable; a unique-key collision never updates an existing owner's allocation.
async function ensureSellerCode(conn, supplierId, generate = () => 'OP-' + randomInt(100000, 1000000)) {
  const id = Number(supplierId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid supplier account');
  const [[existing]] = await conn.execute('SELECT seller_code FROM supplier_seller_codes WHERE supplier_id=?', [id]);
  if (existing) return existing.seller_code;
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generate();
    if (!validSellerCode(code)) throw new Error('Invalid generated seller code');
    try {
      await conn.execute('INSERT INTO supplier_seller_codes (supplier_id,seller_code) VALUES (?,?)', [id, code]);
      return code;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      // A locking read sees a concurrent winner even in a repeatable-read transaction.
      const [[winner]] = await conn.execute('SELECT seller_code FROM supplier_seller_codes WHERE supplier_id=? FOR UPDATE', [id]);
      if (winner) return winner.seller_code;
    }
  }
  throw new Error('Seller code allocation is temporarily unavailable');
}

async function assignApprovedSellerCodes(conn) {
  const [rows] = await conn.execute("SELECT s.id FROM suppliers s LEFT JOIN supplier_seller_codes codes ON codes.supplier_id=s.id WHERE s.status='approved' AND codes.supplier_id IS NULL ORDER BY s.id");
  for (const row of rows) await ensureSellerCode(conn, row.id);
}

const sellerLabel = code => validSellerCode(code) ? 'فروشنده تأییدشده · کد ' + code : 'فروشنده تأییدشده';
module.exports = { sellerCodeSchema, ensureSellerCode, assignApprovedSellerCodes, validSellerCode, sellerLabel };
