const fs=require('node:fs'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const {sellerCodeSchema,ensureSellerCode,assignApprovedSellerCodes,sellerLabel}=require('./sellerCodes');
const {itemSnapshot,insertOrderItem}=require('./orderItemSnapshots');
const states=new WeakMap(),POLICY='shahriar_hub_post_recipient';
const error=(status,message)=>Object.assign(new Error(message),{status});
const citySql="REPLACE(REPLACE(REPLACE(REPLACE(TRIM(s.city),'ي','ی'),'ك','ک'),' ',''),'‌','') IN ('شهریار','شهرشهریار')";
const reservedSql="COALESCE((SELECT SUM(r.quantity) FROM market_reservations r JOIN orders ro ON ro.id=r.order_id WHERE r.supplier_id=i.supplier_id AND r.product_id=i.product_id AND r.state='reserved' AND ro.status<>'cancelled'),0)";
const availableSql=`GREATEST(0,COALESCE(i.quantity,0)-${reservedSql})`;
const eligibleSql=`s.status='approved' AND s.portal_enabled=1 AND ${citySql} AND EXISTS(SELECT 1 FROM supplier_product_scopes scope WHERE scope.supplier_id=i.supplier_id AND scope.scope_type='brand' AND TRIM(scope.scope_value)=TRIM((SELECT brand FROM products WHERE id=i.product_id))) AND i.available=1 AND i.supplier_price IS NOT NULL AND i.final_price>0 AND i.offer_token IS NOT NULL AND ${availableSql}>0`;
function marketplaceSchema(db){
 if(states.has(db))return states.get(db);let promise,status='pending';
 const ensure=()=>promise||=(async()=>{
  await sellerCodeSchema(db)();
  await require('./supplierInventory').supplierInventorySchema(db)();
  await require('./orderItemSnapshots').orderItemSnapshotSchema(db)();
  const c=await db.getConnection();let locked=false;
  try{const [[lock]]=await c.query("SELECT GET_LOCK(CONCAT('onpart:market:',LEFT(SHA2(DATABASE(),256),40)),10) acquired");if(!Number(lock.acquired))throw Error('Marketplace schema busy');locked=true;
   const statements=fs.readFileSync(path.join(__dirname,'../migrations/024_shared_catalog_offers.sql'),'utf8').split(';').map(s=>s.trim()).filter(Boolean);
   for(const sql of statements)await c.query(sql);
   await assignApprovedSellerCodes(c);status='ok';
  }finally{try{if(locked)await c.query("SELECT RELEASE_LOCK(CONCAT('onpart:market:',LEFT(SHA2(DATABASE(),256),40)))");}finally{c.release();}}
 })().catch(e=>{promise=undefined;status='unavailable';throw e;});
 ensure.status=()=>status;states.set(db,ensure);return ensure;
}
async function reservedUnits(conn,supplierId,productId){
 const [rows]=await conn.execute("SELECT r.quantity FROM market_reservations r JOIN orders o ON o.id=r.order_id WHERE r.supplier_id=? AND r.product_id=? AND r.state='reserved' AND o.status<>'cancelled' FOR UPDATE",[supplierId,productId]);
 return rows.reduce((sum,r)=>sum+Number(r.quantity),0);
}
async function publishOffer(conn,supplierId,productId,finalPrice){
 await ensureSellerCode(conn,supplierId);
 const [[i]]=await conn.execute('SELECT * FROM supplier_inventory WHERE supplier_id=? AND product_id=? FOR UPDATE',[supplierId,productId]);
 if(!i)throw error(400,'اطلاعات پیشنهاد فروش یافت نشد');
 const held=await reservedUnits(conn,supplierId,productId);
 if(i.quantity!=null&&Number(i.quantity)<held)throw error(409,'تعداد موجودی از سفارش‌های رزروشده کمتر است');
 const price=finalPrice==null?i.final_price:Number(finalPrice);
 if(price!=null&&(!Number.isSafeInteger(Number(price))||Number(price)<=0))throw error(400,'قیمت نهایی پیشنهاد باید بیشتر از صفر باشد');
 await conn.execute('UPDATE supplier_inventory SET final_price=?,offer_token=COALESCE(offer_token,?),offer_version=offer_version+1 WHERE supplier_id=? AND product_id=?',[price??null,randomBytes(16).toString('hex'),supplierId,productId]);
}
const summaryJoin=`LEFT JOIN (SELECT i.product_id,MIN(i.final_price) market_price,COUNT(*) offer_count FROM supplier_inventory i JOIN suppliers s ON s.id=i.supplier_id WHERE ${eligibleSql} GROUP BY i.product_id) market ON market.product_id=p.id`;
const publicProductSql="p.id,p.code,p.description,p.car,p.brand,p.category,p.image,p.has_flow,market.market_price price,COALESCE(market.offer_count,0) offer_count,(COALESCE(market.offer_count,0)>0) available";
const productDTO=row=>({id:row.id,code:row.code,description:row.description,car:row.car,brand:row.brand,category:row.category,image:row.image,has_flow:row.has_flow,price:row.price==null?null:Number(row.price),offer_count:Number(row.offer_count||0),available:Boolean(Number(row.available)),stock:Number(row.available)?1:0,marketplace:true});
const label=sellerLabel;
async function listOffers(conn,productId){
 const [rows]=await conn.execute(`SELECT codes.seller_code,i.offer_token,i.offer_version,i.final_price,${availableSql} quantity FROM supplier_inventory i JOIN suppliers s ON s.id=i.supplier_id JOIN supplier_seller_codes codes ON codes.supplier_id=s.id JOIN products p ON p.id=i.product_id WHERE i.product_id=? AND p.status='active' AND ${eligibleSql} ORDER BY i.final_price,i.offer_token`,[productId]);
 return rows.map(r=>({offer_token:r.offer_token,offer_version:Number(r.offer_version),price:Number(r.final_price),quantity:Number(r.quantity),seller_code:r.seller_code,label:label(r.seller_code),fulfillment:'تحویل و ارسال از مرکز آن‌پارت در شهریار'}));
}
async function lockOffer(conn,item){
 const [[row]]=await conn.execute(`SELECT i.*,p.code,p.description,p.brand,p.car,p.status FROM supplier_inventory i JOIN suppliers s ON s.id=i.supplier_id JOIN products p ON p.id=i.product_id WHERE i.product_id=? AND i.offer_token=? AND p.status='active' AND s.status='approved' AND s.portal_enabled=1 AND ${citySql} AND EXISTS(SELECT 1 FROM supplier_product_scopes scope WHERE scope.supplier_id=i.supplier_id AND scope.scope_type='brand' AND TRIM(scope.scope_value)=TRIM(p.brand)) FOR UPDATE`,[item.product_id,item.offer_token||'']);
 if(!row||!Number(row.available)||row.final_price==null||row.supplier_price==null)throw error(409,'پیشنهاد انتخاب‌شده فعال نیست؛ دوباره پیشنهادها را بررسی کنید');
 if(Number(row.offer_version)!==Number(item.offer_version)||Number(row.final_price)!==Number(item.expected_price))throw error(409,'قیمت یا موجودی پیشنهاد تغییر کرده است؛ پیش از خرید دوباره آن را انتخاب کنید');
 const held=await reservedUnits(conn,row.supplier_id,row.product_id),quantity=Number(item.quantity);
 if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>9999||row.quantity==null||quantity>Number(row.quantity)-held)throw error(409,'موجودی پیشنهاد برای تعداد انتخاب‌شده کافی نیست');
 if(!Number.isSafeInteger(Number(row.final_price)*quantity)||!Number.isSafeInteger(Number(row.supplier_price)*quantity))throw error(400,'مبلغ ردیف نامعتبر است');
 return row;
}
async function createOrder(conn,userId,items,key){
 if(!/^[0-9a-f-]{36}$/i.test(String(key||'')))throw error(400,'شناسه ثبت سفارش نامعتبر است');
 await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
 const fingerprint=createHash('sha256').update(JSON.stringify([...items].sort((a,b)=>a.product_id-b.product_id))).digest('hex');
 const [[prior]]=await conn.execute('SELECT id,total,request_fingerprint FROM orders WHERE user_id=? AND request_key=?',[userId,key]);
 if(prior){if(prior.request_fingerprint!==fingerprint)throw error(409,'این شناسه قبلاً برای سبد دیگری استفاده شده است');return {id:prior.id,total:prior.total,replayed:true};}
 const lines=[];let total=0;
 for(const item of [...items].sort((a,b)=>a.product_id-b.product_id)){
  if(!item.offer_token)throw error(409,'برای هر کالا ابتدا یک پیشنهاد فروشنده انتخاب کنید');
  const offer=await lockOffer(conn,item);total+=Number(offer.final_price)*item.quantity;
  if(!Number.isSafeInteger(total))throw error(400,'مبلغ سفارش نامعتبر است');lines.push({item,offer});
 }
 const [created]=await conn.execute('INSERT INTO orders (user_id,total,status,fulfillment_policy,hub_city,request_key,request_fingerprint) VALUES (?,?,"pending_expert",?,"شهریار",?,?)',[userId,total,POLICY,key,fingerprint]);
 for(const {item,offer} of lines){
  const snapshot=itemSnapshot({...offer,supplier_cost_price:offer.supplier_price,cost_price:offer.supplier_price});snapshot.offerToken=offer.offer_token;
  const itemId=await insertOrderItem(conn,created.insertId,item.product_id,item.quantity,Number(offer.final_price),0,Number(offer.final_price)*item.quantity,snapshot);
  await conn.execute('INSERT INTO market_reservations (order_item_id,order_id,supplier_id,product_id,quantity) VALUES (?,?,?,?,?)',[itemId,created.insertId,offer.supplier_id,item.product_id,item.quantity]);
 }
 return {id:created.insertId,total,replayed:false};
}
async function assertReceived(conn,orderId){
 const [[row]]=await conn.execute("SELECT COUNT(*) missing FROM order_items oi LEFT JOIN market_reservations r ON r.order_item_id=oi.id WHERE oi.order_id=? AND oi.offer_token IS NOT NULL AND (r.state IS NULL OR r.state<>'consumed')",[orderId]);
 if(Number(row.missing))throw error(409,'ابتدا دریافت تمام اقلام سفارش در مرکز شهریار را ثبت کنید');
}
module.exports={marketplaceSchema,reservedUnits,publishOffer,summaryJoin,publicProductSql,productDTO,listOffers,lockOffer,createOrder,assertReceived,availableSql,eligibleSql,label,POLICY,error};
