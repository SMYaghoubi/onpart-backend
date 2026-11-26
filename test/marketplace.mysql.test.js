const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {load}=require('./supplierImages.fixture.cjs');
test('shared catalog, reviewed anonymous offers, exact-supplier orders and Shahriar hub through isolated MySQL and authenticated HTTP',{skip:process.env.ONPART_MARKET_TEST_MYSQL!=='1'},async t=>{
 const mysql=require('mysql2/promise'),express=require('express'),jwt=require('jsonwebtoken');
 const settings={host:'127.0.0.1',port:33078,user:'root',password:'',charset:'utf8mb4',multipleStatements:true};
 const admin=await mysql.createConnection(settings),[[identity]]=await admin.query('SELECT @@server_id server_id');
 if(Number(identity.server_id)!==760023){await admin.end();throw Error('Refusing nonisolated database');}
 const name='onpart_market_test_'+randomUUID().replace(/-/g,''),uploads=await fs.mkdtemp(path.join(os.tmpdir(),'onpart-market-test-'));
 let pool,server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool?.end();await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();await fs.rm(uploads,{recursive:true,force:true});});
 let schema=await fs.readFile(path.join(__dirname,'../config/schema.sql'),'utf8');schema=schema.replace(/CREATE DATABASE IF NOT EXISTS onpart /,'CREATE DATABASE '+name+' ').replace('USE onpart;','USE '+name+';');await admin.query(schema);
 for(const file of (await fs.readdir(path.join(__dirname,'../migrations'))).filter(f=>/^\d+.*\.sql$/.test(f)&&Number(f.slice(0,3))<24).sort())await admin.query(await fs.readFile(path.join(__dirname,'../migrations',file),'utf8'));
 pool=mysql.createPool({...settings,database:name,multipleStatements:false,connectionLimit:10});
 const dbFile=require.resolve('../config/database');require.cache[dbFile]={id:dbFile,filename:dbFile,loaded:true,exports:pool};
 process.env.UPLOAD_PATH=uploads;process.env.JWT_SECRET='isolated-market-test-secret';
 await pool.execute('INSERT INTO users (id,name,phone,role,status) VALUES (9,"Test Manager","09000000009","admin","active"),(101,"Test Buyer A","09000000101","user","active"),(102,"Test Buyer B","09000000102","user","active"),(103,"Pending buyer","09000000103","user","pending")');
 for(const [id,city,status] of [[1,'شهریار','approved'],[2,'شهر شهریار','approved'],[3,'تهران','approved'],[4,'شهریار','pending'],[5,'شهریار','approved']]){await pool.execute('INSERT INTO suppliers (id,company,name,mobile,city,status,portal_enabled) VALUES (?,?,?,?,?,?,?)',[id,'PRIVATE SELLER '+id,'Private owner '+id,'0900000000'+id,city,status,id===4?0:1]);await pool.execute('INSERT INTO supplier_product_scopes (supplier_id,scope_type,scope_value) VALUES (?,"brand","TestBrand")',[id]);}
 await pool.execute('INSERT INTO products (id,code,description,car,brand,price,stock,supplier_id) VALUES (10,"MASTER-10","کالای مشترک آزمایشی","خودروی آزمایشی","TestBrand",999999,1,1),(11,"MASTER-11","کالای دوم آزمایشی","","TestBrand",999999,1,1),(12,"LEGACY","قدیمی بدون پیشنهاد","","TestBrand",12345,1,1)');
 await pool.execute('INSERT INTO supplier_inventory (supplier_id,product_id,supplier_price,quantity,available) VALUES (1,10,100000,5,1),(2,10,80000,6,1),(3,10,10000,20,1),(4,10,5000,20,1),(5,10,6000,20,1),(1,11,200000,3,1),(1,12,10000,10,1)');
 await pool.execute('INSERT INTO orders (id,user_id,total,status) VALUES (900,101,12345,"pending_expert")');await pool.execute('INSERT INTO order_items (order_id,product_id,quantity,price,cost_price,total) VALUES (900,12,1,12345,10000,12345)');
 const auth=load('middleware/auth.js',{'../config/database':pool});
 const common={'../config/database':pool,'../middleware/auth':auth},noops={createUserNotification:async()=>{},broadcastUserDataChanged:()=>{},deleteUserNotificationsForEntity:async()=>{},broadcastUserNotificationsChanged:()=>{}};
 const orderRouter=load('routes/orders.js',{...common,'../config/sms':new Proxy({},{get:()=>async()=>{}}),'../config/notif':{createNotif:async()=>{}},'../lib/userNotifications':noops,'../lib/adminNotifications':{resolveAdminNotification:async()=>{},notifyAdminNotificationsChanged:()=>{}}});
 const portal=load('routes/supplierPortal.js',{...common,'../config/sms':{},'../config/notif':{createNotif:async()=>{}},'../lib/userNotifications':noops,'../lib/adminNotifications':{resolveAdminNotification:async()=>{},notifyAdminNotificationsChanged:()=>{}}});
 const app=express();app.use(express.json());app.use('/api/orders',orderRouter);app.use('/api/products',load('routes/products.js',common));app.use('/api/cart',load('routes/cart.js',common));app.use('/api/supplier-portal',portal,load('routes/supplierOrders.js',common));app.use('/api/marketplace',load('routes/marketplace.js',common));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const url='http://127.0.0.1:'+server.address().port;
 const buyer=id=>jwt.sign({id,role:'user',context:'shop'},process.env.JWT_SECRET),manager=jwt.sign({id:9,role:'admin',context:'management'},process.env.JWT_SECRET),supplier=id=>jwt.sign({supplier_id:id,role:'supplier'},process.env.JWT_SECRET);
 async function request(p,{token=buyer(101),method='GET',body}={}){const res=await fetch(url+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};}
 const ok=(r,status=200)=>assert.equal(r.status,status,JSON.stringify(r.data));
 function privateBuyer(data){const text=JSON.stringify(data);assert.doesNotMatch(text,/PRIVATE SELLER|Private owner|0900000000|supplier_id|supplier_name|supplier_price|cost_price/);}
 const market=require('../lib/marketplace');await market.marketplaceSchema(pool)();
 let list=await request('/api/products?limit=50');ok(list);assert.equal(list.data.products.length,3);assert.equal(list.data.products.find(p=>p.id===10).price,null);privateBuyer(list.data);
 // Old records stay untouched; prices are explicitly reviewed through the existing management flow.
 const migration=await fs.readFile(path.join(__dirname,'../migrations/024_shared_catalog_offers.sql'),'utf8');await admin.query(migration);await admin.query(migration);
 const [[old]]=await pool.query('SELECT supplier_id,offer_token FROM order_items WHERE order_id=900');assert.equal(old.supplier_id,null);assert.equal(old.offer_token,null);
 async function submit(id,items){return request('/api/supplier-portal/updates',{token:supplier(id),method:'POST',body:{items:items.map(item=>({...item,code:item.code||'MASTER-'+item.product_id})),request_key:randomUUID()}});}
 async function approve(id,items,percent=5){const batch=await submit(id,items);ok(batch,201);const result=await request('/api/supplier-portal/admin/updates/'+batch.data.id+'/approve',{token:manager,method:'POST',body:{markup_percent:percent}});ok(result);return batch.data.id;}
 await approve(1,[{product_id:10,supplier_price:100000,quantity:5,available:true},{product_id:11,supplier_price:200000,quantity:3,available:true}]);
 // A pending lower price cannot appear until approved.
 const pending=await submit(2,[{product_id:10,supplier_price:80000,quantity:6,available:true}]);ok(pending,201);
 let offers=(await request('/api/products/10/offers')).data.offers;assert.equal(offers.length,1);assert.equal(offers[0].price,105000);
 ok(await request('/api/supplier-portal/admin/updates/'+pending.data.id+'/approve',{token:manager,method:'POST',body:{markup_percent:5}}));
 await approve(3,[{product_id:10,supplier_price:10000,quantity:20,available:true}]);
 await pool.execute('UPDATE supplier_inventory SET final_price=5250,offer_token=?,offer_version=1 WHERE supplier_id=4 AND product_id=10',['4'.repeat(32)]);
 await approve(5,[{product_id:10,supplier_price:6000,quantity:20,available:true}]);await pool.execute('UPDATE suppliers SET portal_enabled=0 WHERE id=5');
 // Code-only Excel/paste rows retain this seller's reviewed price, not the last global summary.
 await approve(1,[{code:'MASTER-10',quantity:6}]);
 const [[retainedPrice]]=await pool.query('SELECT final_price FROM supplier_inventory WHERE supplier_id=1 AND product_id=10');assert.equal(Number(retainedPrice.final_price),105000);
 list=await request('/api/products?search=MASTER-10&brand=TestBrand');ok(list);assert.equal(list.data.products.length,1);assert.equal(list.data.products[0].offer_count,2);assert.equal(list.data.products[0].price,84000);privateBuyer(list.data);
 let detail=await request('/api/products/10/offers');ok(detail);privateBuyer(detail.data);assert.deepEqual(detail.data.offers.map(o=>o.price),[84000,105000]);assert.equal(detail.data.shipping.hub_city,'شهریار');
 const chosen=detail.data.offers[0],other=detail.data.offers[1];
 const row=(o,q=1,id=10)=>({product_id:id,quantity:q,offer_token:o.offer_token,offer_version:o.offer_version,expected_price:o.price});
 ok(await request('/api/cart/item',{method:'PATCH',body:{product_id:10,quantity:1}}),409);
 ok(await request('/api/cart/item',{method:'PATCH',body:row(chosen,2)}));
 let cart=await request('/api/cart');ok(cart);privateBuyer(cart.data);assert.equal(cart.data[0].price,84000);assert.equal(cart.data[0].needs_review,false);
 ok(await request('/api/cart/item',{method:'PATCH',body:row(other,1)}));cart=await request('/api/cart');assert.equal(cart.data.length,1);assert.equal(cart.data[0].price,105000); // explicit replacement, no duplicate SKU
 ok(await request('/api/cart/item',{method:'PATCH',body:row(chosen,2)}));
 const orderBody={items:[{...row(chosen,2),supplier_id:1,cost_price:1}],request_key:randomUUID()};
 let created=await request('/api/orders',{method:'POST',body:orderBody});ok(created,201);const id=created.data.id;assert.equal(created.data.total,168000);
 const [[line]]=await pool.execute('SELECT * FROM order_items WHERE order_id=?',[id]);assert.equal(line.supplier_id,2);assert.equal(Number(line.cost_price),80000);assert.equal(Number(line.price),84000);assert.equal(line.snapshot_code,'MASTER-10');
 ok(await request('/api/orders/'+id+'/items',{token:manager,method:'PUT',body:{items:[{product_id:10,quantity:2,price:1}]}}),409);
 let replay=await request('/api/orders',{method:'POST',body:orderBody});ok(replay);assert.equal(replay.data.id,id);
 ok(await request('/api/orders',{method:'POST',body:{...orderBody,items:[row(chosen,1)]}}),409);
 const [held]=await pool.query('SELECT * FROM market_reservations WHERE order_id=?',[id]);assert.equal(held.length,1);assert.equal(Number(held[0].quantity),2);
 privateBuyer((await request('/api/orders/'+id)).data);privateBuyer((await request('/api/orders/my')).data);
 // All public reads require approved buyer sessions; supplier access is separate.
 for(const token of [null,supplier(1),manager,buyer(103)]){assert.ok([401,403].includes((await request('/api/products/10/offers',{token})).status));assert.ok([401,403].includes((await request('/api/cart',{token})).status));}
 ok(await request('/api/marketplace/admin/orders/'+id+'/receipts'),403);
 // Price and inventory edits invalidate a quote instead of silently changing the order.
 await approve(2,[{product_id:10,supplier_price:90000,quantity:6}]);
 ok(await request('/api/orders',{method:'POST',body:{items:[row(chosen,1)],request_key:randomUUID()}}),409);
 cart=await request('/api/cart');assert.equal(cart.data[0].needs_review,true);assert.equal(cart.data[0].price,84000);
 const [[unchanged]]=await pool.query('SELECT cost_price,price,supplier_id FROM order_items WHERE order_id=?',[id]);assert.equal(Number(unchanged.cost_price),80000);assert.equal(Number(unchanged.price),84000);assert.equal(unchanged.supplier_id,2);
 const tooLow=await submit(2,[{product_id:10,quantity:1}]);ok(tooLow,201);ok(await request('/api/supplier-portal/admin/updates/'+tooLow.data.id+'/approve',{token:manager,method:'POST',body:{markup_percent:5}}),400);
 const [[stockAfterRejected]]=await pool.query('SELECT quantity FROM supplier_inventory WHERE supplier_id=2 AND product_id=10');assert.equal(Number(stockAfterRejected.quantity),6);
 // Active unpaid reservations prevent overselling; cancellation frees them.
 let fresh=(await request('/api/products/10/offers')).data.offers.find(o=>o.offer_token===chosen.offer_token);
 const concurrent=await Promise.all([101,102].map(uid=>request('/api/orders',{token:buyer(uid),method:'POST',body:{items:[row(fresh,3)],request_key:randomUUID()}})));
 assert.equal(concurrent.filter(r=>r.status===201).length,1,JSON.stringify(concurrent));assert.equal(concurrent.filter(r=>r.status===409).length,1,JSON.stringify(concurrent));
 const extra=concurrent.find(r=>r.status===201).data.id;ok(await request('/api/orders/'+extra+'/status',{token:manager,method:'PATCH',body:{status:'cancelled'}}));
 fresh=(await request('/api/products/10/offers')).data.offers.find(o=>o.offer_token===chosen.offer_token);assert.equal(fresh.quantity,4);
 // Hub receives only fully paid orders; no buyer data reaches sellers.
 ok(await request('/api/marketplace/admin/orders/'+id+'/receive',{token:manager,method:'POST',body:{item_ids:[line.id]}}),409);
 ok(await request('/api/orders/'+id+'/approve',{token:manager,method:'PATCH'}));ok(await request('/api/orders/'+id+'/customer-approve',{method:'PATCH'}));
 const {approvePayment}=require('../lib/paymentApproval');
 async function pay(orderId,amount){const [p]=await pool.execute('INSERT INTO payments (user_id,order_id,amount,status) VALUES (101,?,?,"pending")',[orderId,amount]);const c=await pool.getConnection();try{await c.beginTransaction();await approvePayment(c,p.insertId,9);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}}
 await pay(id,1000);assert.equal((await request('/api/supplier-portal/orders',{token:supplier(2)})).data.total,0);
 await pay(id,167000);let seller=await request('/api/supplier-portal/orders/'+id,{token:supplier(2)});ok(seller);assert.equal(Number(seller.data.supplier_total),160000);assert.doesNotMatch(JSON.stringify(seller.data),/Test Buyer|09000000101|address|user_id|shipping_tracking/);ok(await request('/api/supplier-portal/orders/'+id,{token:supplier(1)}),404);
 ok(await request('/api/orders/'+id+'/ship',{token:manager,method:'PATCH',body:{shipping_method:'post',shipping_tracking:'TEST'}}),409);
 ok(await request('/api/orders/'+id+'/status',{token:manager,method:'PATCH',body:{status:'shipping'}}),409);
 ok(await request('/api/marketplace/admin/orders/'+id+'/receive',{token:manager,method:'POST',body:{item_ids:[line.id]}}));
 ok(await request('/api/marketplace/admin/orders/'+id+'/receive',{token:manager,method:'POST',body:{item_ids:[line.id]}}));
 const [[physical]]=await pool.query('SELECT quantity FROM supplier_inventory WHERE supplier_id=2 AND product_id=10');assert.equal(Number(physical.quantity),4,'idempotent hub receipt consumes stock once');
 ok(await request('/api/orders/'+id+'/ship',{token:manager,method:'PATCH',body:{shipping_method:'tipax'}}),409);
 ok(await request('/api/orders/'+id+'/ship',{token:manager,method:'PATCH',body:{shipping_method:'post',shipping_tracking:'TEST-ONLY-123'}}));
 // Cancellation after hub receipt does not manufacture stock back at the supplier.
 const receipts=await request('/api/marketplace/admin/orders/'+id+'/receipts',{token:manager});ok(receipts);assert.equal(receipts.data.items[0].state,'consumed');assert.equal(receipts.data.items[0].supplier_name,'PRIVATE SELLER 2');
 // A multi-item order cannot leave the hub after only one supplier delivery.
 const offer11=(await request('/api/products/11/offers')).data.offers[0];
 const mixed=await request('/api/orders',{method:'POST',body:{items:[row(other,1),row(offer11,2,11)],request_key:randomUUID()}});ok(mixed,201);
 ok(await request('/api/orders/'+mixed.data.id+'/approve',{token:manager,method:'PATCH'}));ok(await request('/api/orders/'+mixed.data.id+'/customer-approve',{method:'PATCH'}));await pay(mixed.data.id,mixed.data.total);
 const [mixedLines]=await pool.query('SELECT id FROM order_items WHERE order_id=? ORDER BY id',[mixed.data.id]);
 ok(await request('/api/marketplace/admin/orders/'+mixed.data.id+'/receive',{token:manager,method:'POST',body:{item_ids:[mixedLines[0].id]}}));
 ok(await request('/api/orders/'+mixed.data.id+'/ship',{token:manager,method:'PATCH',body:{shipping_method:'post'}}),409);
 ok(await request('/api/marketplace/admin/orders/'+mixed.data.id+'/receive',{token:manager,method:'POST',body:{item_ids:[mixedLines[1].id]}}));
 ok(await request('/api/orders/'+mixed.data.id+'/ship',{token:manager,method:'PATCH',body:{shipping_method:'post',shipping_tracking:'TEST-MULTI'}}));
 ok(await request('/api/orders/'+mixed.data.id+'/status',{token:manager,method:'PATCH',body:{status:'delivered',clear_shipping:true}}),409);
 // A failing second row rolls back the whole new quote order and its reservations.
 await admin.query("CREATE TRIGGER market_snapshot_failure BEFORE INSERT ON order_items FOR EACH ROW BEGIN IF NEW.product_id=11 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated market failure'; END IF; END");
 const [[beforeCounts]]=await pool.query('SELECT (SELECT COUNT(*) FROM orders) headers,(SELECT COUNT(*) FROM market_reservations) reservations');
 ok(await request('/api/orders',{method:'POST',body:{items:[row(other,1),row(offer11,1,11)],request_key:randomUUID()}}),500);
 const [[afterCounts]]=await pool.query('SELECT (SELECT COUNT(*) FROM orders) headers,(SELECT COUNT(*) FROM market_reservations) reservations');assert.deepEqual(afterCounts,beforeCounts);
 await admin.query('DROP TRIGGER market_snapshot_failure');
 // Revoking a seller's reviewed brand permission hides the quote and blocks direct checkout too.
 const revisionBefore=(await request('/api/products/10/offers')).data.offers.find(o=>o.offer_token===chosen.offer_token);
 await pool.execute('DELETE FROM supplier_product_scopes WHERE supplier_id=2');
 const hidden=(await request('/api/products/10/offers')).data.offers;assert.equal(hidden.some(o=>o.offer_token===chosen.offer_token),false);
 ok(await request('/api/orders',{method:'POST',body:{items:[row(revisionBefore,1)],request_key:randomUUID()}}),409);
 // A legacy cart is visible, but cannot silently choose a supplier or create a free order.
 await pool.execute('INSERT INTO cart_items (user_id,product_id,quantity) VALUES (102,12,1)');const legacyCart=await request('/api/cart',{token:buyer(102)});assert.equal(legacyCart.data.find(i=>i.product_id===12).needs_selection,true);assert.equal(legacyCart.data.find(i=>i.product_id===12).price,null);
 ok(await request('/api/orders',{token:buyer(102),method:'POST',body:{items:[{product_id:12,quantity:1}],request_key:randomUUID()}}),409);
 await pool.execute('UPDATE products SET description=? WHERE id=10',['نام جدید کاتالوگ']);
 const historic=await request('/api/orders/'+id);ok(historic);assert.equal(historic.data.items[0].description,'کالای مشترک آزمایشی');privateBuyer(historic.data);
 const management=await request('/api/products/10?admin=1',{token:manager});ok(management);assert.equal(management.data.supplier_id,2);assert.equal(management.data.description,'نام جدید کاتالوگ');
 t.diagnostic('Real MySQL: explicit approval, anonymous competing prices, exact offer snapshots, quote invalidation, reservations, concurrent stock safety, idempotent order and receipt, own-seller privacy, post-only hub fulfillment passed.');
});
