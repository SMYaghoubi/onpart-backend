const router=require('express').Router(),db=require('../config/database');
const {adminAuth}=require('../middleware/auth');
const market=require('../lib/marketplace');
async function ready(_req,res,next){try{await market.marketplaceSchema(db)();next();}catch(e){res.status(503).json({message:'بخش تحویل مرکز موقتاً آماده نیست'})}}
const valid=id=>Number.isSafeInteger(Number(id))&&Number(id)>0;
router.get('/admin/orders/:id/receipts',adminAuth,ready,async(req,res)=>{
 if(!valid(req.params.id))return res.status(400).json({message:'شماره سفارش نامعتبر است'});
 try{const [[order]]=await db.execute('SELECT id,status,fulfillment_policy,hub_city FROM orders WHERE id=?',[req.params.id]);if(!order)return res.status(404).json({message:'سفارش یافت نشد'});
  const [items]=await db.execute("SELECT oi.id,oi.snapshot_code code,oi.snapshot_name description,oi.quantity,s.company supplier_name,codes.seller_code,r.state,r.received_at FROM order_items oi LEFT JOIN suppliers s ON s.id=oi.supplier_id LEFT JOIN supplier_seller_codes codes ON codes.supplier_id=s.id LEFT JOIN market_reservations r ON r.order_item_id=oi.id WHERE oi.order_id=? AND oi.offer_token IS NOT NULL ORDER BY oi.id",[order.id]);
  res.json({order,items});
 }catch(e){res.status(500).json({message:'دریافت اطلاعات تحویل انجام نشد'})}
});
router.post('/admin/orders/:id/receive',adminAuth,ready,async(req,res)=>{
 const ids=Array.isArray(req.body.item_ids)?[...new Set(req.body.item_ids.map(Number))]:[];
 if(!valid(req.params.id)||!ids.length||ids.length>200||ids.some(id=>!valid(id)))return res.status(400).json({message:'اقلام دریافتی را انتخاب کنید'});
 const c=await db.getConnection();
 try{await c.beginTransaction();const [[order]]=await c.execute('SELECT id,total,status,fulfillment_policy FROM orders WHERE id=? FOR UPDATE',[req.params.id]);
  if(!order||order.fulfillment_policy!==market.POLICY)throw market.error(404,'سفارش تجمیعی یافت نشد');
  if(!['preparing','shipping'].includes(order.status))throw market.error(409,'سفارش در مرحله دریافت کالا نیست');
  const [[payment]]=await c.execute("SELECT COALESCE(SUM(pa.amount),0) amount FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.order_id=? AND p.status='approved'",[order.id]);
  if(Number(payment.amount)<Number(order.total))throw market.error(409,'پرداخت سفارش هنوز کامل و تأیید نشده است');
  for(const id of ids){const [[r]]=await c.execute('SELECT * FROM market_reservations WHERE order_item_id=? AND order_id=? FOR UPDATE',[id,order.id]);
   if(!r)throw market.error(404,'ردیف متعلق به این سفارش نیست');if(r.state==='consumed')continue;
   const [[stock]]=await c.execute('SELECT quantity FROM supplier_inventory WHERE supplier_id=? AND product_id=? FOR UPDATE',[r.supplier_id,r.product_id]);
   if(!stock||Number(stock.quantity)<Number(r.quantity))throw market.error(409,'موجودی این ردیف نیازمند بررسی مدیریت است');
   await c.execute('UPDATE supplier_inventory SET available=CASE WHEN quantity>? THEN available ELSE 0 END,quantity=quantity-? WHERE supplier_id=? AND product_id=?',[r.quantity,r.quantity,r.supplier_id,r.product_id]);
   await c.execute("UPDATE market_reservations SET state='consumed',received_by=?,received_at=NOW() WHERE order_item_id=?",[req.user.id,id]);
  }
  await c.commit();res.json({message:'دریافت اقلام انتخاب‌شده در مرکز شهریار ثبت شد'});
 }catch(e){await c.rollback();res.status(e.status||500).json({message:e.status?e.message:'ثبت دریافت کالا انجام نشد؛ دوباره تلاش کنید'});}finally{c.release();}
});
module.exports=router;
