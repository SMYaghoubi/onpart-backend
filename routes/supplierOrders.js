const router = require('express').Router();
const db = require('../config/database');
const { supplierAuth } = require('../middleware/auth');
const { orderItemSnapshotSchema } = require('../lib/orderItemSnapshots');
const ensureSchema = orderItemSnapshotSchema(db);
const statuses = ['preparing','shipping','delivered','cancelled'];
const paid = `(o.total=0 OR COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
  JOIN payments payment ON payment.id=pa.payment_id
  WHERE pa.order_id=o.id AND payment.status='approved'),0)>=o.total)`;
const knownTotal = 'CASE WHEN MIN(oi.supplier_price_known)=1 THEN SUM(oi.quantity*oi.cost_price) ELSE NULL END';
async function ready(_req,res,next) {
  try { await ensureSchema();next(); }
  catch(error) { console.error('Supplier order schema:',error.message);res.status(503).json({message:'سفارش‌های فروشنده موقتاً در دسترس نیستند.'}); }
}

router.get('/orders',supplierAuth,ready,async(req,res)=>{
  const page = Number(req.query.page || 1), status = String(req.query.status || '');
  if (!Number.isSafeInteger(page) || page<1 || page>100000 || (status && !statuses.includes(status))) return res.status(400).json({message:'صفحه یا وضعیت سفارش نامعتبر است.'});
  const limit=20, params=[req.supplier.id], where=["oi.supplier_id=?", "o.status IN ('preparing','shipping','delivered','cancelled')",paid];
  if (status) {where.push('o.status=?');params.push(status);}
  try {
    const [orders] = await db.execute(
      `SELECT o.id,o.created_at,o.status,COUNT(*) line_count,SUM(oi.quantity) quantity,
       ${knownTotal} supplier_total FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE ${where.join(' AND ')} GROUP BY o.id,o.created_at,o.status
       ORDER BY o.created_at DESC,o.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`,params);
    const [[count]] = await db.execute(`SELECT COUNT(DISTINCT o.id) total FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${where.join(' AND ')}`,params);
    res.json({orders,total:Number(count.total),page,limit});
  } catch(error) {console.error('Supplier orders:',error.message);res.status(500).json({message:'دریافت سفارش‌های شما انجام نشد.'});}
});

router.get('/orders/:id',supplierAuth,ready,async(req,res)=>{
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id<=0) return res.status(400).json({message:'شماره سفارش نامعتبر است.'});
  try {
    const [[order]] = await db.execute(
      `SELECT o.id,o.created_at,o.status,COUNT(*) line_count,SUM(oi.quantity) quantity,
       ${knownTotal} supplier_total FROM order_items oi JOIN orders o ON o.id=oi.order_id
       WHERE oi.supplier_id=? AND o.id=? AND o.status IN ('preparing','shipping','delivered','cancelled') AND ${paid}
       GROUP BY o.id,o.created_at,o.status`,[req.supplier.id,id]);
    if (!order) return res.status(404).json({message:'سفارش یافت نشد.'});
    const [items] = await db.execute(
      `SELECT oi.id,oi.snapshot_code code,oi.snapshot_name description,oi.snapshot_brand brand,oi.car_name car,oi.quantity,
       CASE WHEN oi.supplier_price_known=1 THEN oi.cost_price ELSE NULL END supplier_price,
       CASE WHEN oi.supplier_price_known=1 THEN oi.quantity*oi.cost_price ELSE NULL END supplier_total
       FROM order_items oi WHERE oi.order_id=? AND oi.supplier_id=? ORDER BY oi.id`,[id,req.supplier.id]);
    res.json({...order,items});
  } catch(error) {console.error('Supplier order detail:',error.message);res.status(500).json({message:'دریافت جزئیات سفارش انجام نشد.'});}
});

module.exports=router;
