const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {load}=require('./supplierImages.fixture.cjs');
test('supplier order ownership and snapshots through real MySQL, payment allocation and authenticated HTTP', {skip:process.env.ONPART_ORDERS_TEST_MYSQL!=='1'},async t=>{
 const mysql=require('mysql2/promise'),express=require('express'),jwt=require('jsonwebtoken');
 const settings={host:'127.0.0.1',port:33078,user:'root',password:'',charset:'utf8mb4',multipleStatements:true};
 const admin=await mysql.createConnection(settings);
 const [[identity]]=await admin.query('SELECT @@server_id server_id');
 if(Number(identity.server_id)!==760023){await admin.end();throw new Error('Not the isolated supplier-order test server');}
 const name='onpart_order_test_'+randomUUID().replace(/-/g,''),uploads=await fs.mkdtemp(path.join(os.tmpdir(),'onpart-order-test-'));
 let pool,server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool?.end();await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();await fs.rm(uploads,{recursive:true,force:true});});
 let schema=await fs.readFile(path.join(__dirname,'../config/schema.sql'),'utf8');
 schema=schema.replace(/CREATE DATABASE IF NOT EXISTS onpart /,'CREATE DATABASE '+name+' ').replace('USE onpart;','USE '+name+';');
 await admin.query(schema);
 for(const file of (await fs.readdir(path.join(__dirname,'../migrations'))).filter(f=>/^\d+.*\.sql$/.test(f)&&Number(f.slice(0,3))<23).sort())await admin.query(await fs.readFile(path.join(__dirname,'../migrations',file),'utf8'));
 pool=mysql.createPool({...settings,database:name,multipleStatements:false,connectionLimit:6});
 process.env.UPLOAD_PATH=uploads;process.env.JWT_SECRET='isolated-supplier-order-test';
 await pool.execute('INSERT INTO users (id,name,phone,role,status) VALUES (9,"Test Admin","09000000009","admin","active"),(101,"Test Buyer","09000000101","user","active")');
 for(const id of [1,2,3])await pool.execute('INSERT INTO suppliers (id,company,name,mobile,status,portal_enabled) VALUES (?,?,?,?,?,?)',[id,'Test supplier '+id,'Test owner','0900000000'+id,id===3?'pending':'approved',id===3?0:1]);
 for(const [id,supplierId,price,description] of [[10,1,105000,'کالای آزمایشی الف'],[11,2,210000,'کالای آزمایشی ب'],[12,1,50000,'کالای بدون قیمت تأمین'],[13,null,80000,'کالای بدون تأمین‌کننده']])await pool.execute('INSERT INTO products (id,code,description,car,brand,price,stock,supplier_id) VALUES (?,?,?,?,?,?,1,?)',[id,'TEST-'+id,description,'خودروی آزمایشی','برند مشترک',price,supplierId]);
 await pool.execute('INSERT INTO supplier_inventory (supplier_id,product_id,supplier_price,quantity,available) VALUES (1,10,100000,20,1),(2,10,70000,20,1),(2,11,200000,20,1)');
 // A real pre-feature order: no backfill may attribute it to today's product owner.
 await pool.execute('INSERT INTO orders (id,user_id,total,status,debt_remaining) VALUES (900,101,105000,"preparing",0)');
 await pool.execute('INSERT INTO order_items (order_id,product_id,car_name,quantity,price,cost_price,total) VALUES (900,10,"خودروی قدیمی",1,105000,100000,105000)');
 const auth=load('middleware/auth.js',{'../config/database':pool});
 const noops={createUserNotification:async()=>{},broadcastUserDataChanged:()=>{},deleteUserNotificationsForEntity:async()=>{},broadcastUserNotificationsChanged:()=>{}};
 const orderRouter=load('routes/orders.js',{'../config/database':pool,'../middleware/auth':auth,'../config/sms':{orderConfirmed:async()=>{},orderApproved:async()=>{},orderAcceptedByCustomer:async()=>{}},'../config/notif':{createNotif:async()=>{}},'../lib/userNotifications':noops,'../lib/adminNotifications':{resolveAdminNotification:async()=>{},notifyAdminNotificationsChanged:()=>{}}});
 const sellerRouter=load('routes/supplierOrders.js',{'../config/database':pool,'../middleware/auth':auth});
 const app=express();app.use(express.json());app.use('/api/orders',orderRouter);app.use('/api/supplier-portal',sellerRouter);
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const url='http://127.0.0.1:'+server.address().port;
 const buyer=jwt.sign({id:101,role:'user',context:'shop'},process.env.JWT_SECRET),manager=jwt.sign({id:9,role:'admin',context:'management'},process.env.JWT_SECRET);
 const supplier=id=>jwt.sign({supplier_id:id,role:'supplier'},process.env.JWT_SECRET);
 async function request(p,{token=buyer,method='GET',body}={}){const r=await fetch(url+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 const base='/api/supplier-portal/orders';
 let created=await request('/api/orders',{method:'POST',body:{items:[{product_id:10,quantity:2,supplier_id:2,cost_price:1},{product_id:11,quantity:3}]}});
 assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id;
 assert.equal(created.data.total,840000);
 let [rows]=await pool.execute('SELECT * FROM order_items WHERE order_id=? ORDER BY product_id',[id]);
 assert.deepEqual(rows.map(r=>[r.supplier_id,Number(r.cost_price),r.supplier_price_known]),[[1,100000,1],[2,200000,1]]);
 assert.equal((await request(base,{token:supplier(1)})).data.orders.length,0);
 // Catalog edits cannot move the previously ordered items to another supplier.
 await pool.execute('UPDATE products SET supplier_id=2,description="Changed name",brand="Changed brand",code="CHANGED",price=999999 WHERE id=10');
 await pool.execute('UPDATE supplier_inventory SET supplier_price=80000 WHERE product_id=10 AND supplier_id=1');
 const edited=await request('/api/orders/'+id+'/items',{method:'PUT',token:manager,body:{items:[{product_id:10,quantity:3,price:105000,supplier_id:2},{product_id:11,quantity:1,price:210000}],overall_discount:10}});
 assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.total,472500);
 [rows]=await pool.execute('SELECT * FROM order_items WHERE order_id=? ORDER BY product_id',[id]);
 assert.deepEqual(rows.map(r=>[r.supplier_id,Number(r.cost_price)]),[[1,100000],[2,200000]]);
 assert.equal(rows[0].snapshot_code,'TEST-10');assert.equal(rows[0].snapshot_name,'کالای آزمایشی الف');
 assert.equal((await request('/api/orders/'+id+'/approve',{method:'PATCH',token:manager})).status,200);
 assert.equal((await request('/api/orders/'+id+'/customer-approve',{method:'PATCH'})).status,200);
 const locked=await request('/api/orders/'+id+'/items',{method:'PUT',token:manager,body:{items:[{product_id:10,quantity:1,price:1}]}});assert.equal(locked.status,409);
 const {approvePayment}=require('../lib/paymentApproval');
 async function pay(orderId,amount){const [payment]=await pool.execute('INSERT INTO payments (user_id,order_id,amount,status) VALUES (101,?,?,"pending")',[orderId,amount]);const c=await pool.getConnection();try{await c.beginTransaction();await approvePayment(c,payment.insertId,9);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}}
 await pay(id,100000);
 assert.equal((await request(base,{token:supplier(1)})).data.orders.length,0);
 await pool.execute('UPDATE orders SET status="preparing" WHERE id=?',[id]);
 assert.equal((await request(base,{token:supplier(1)})).data.orders.length,0,'a status alone does not prove full payment');
 await pool.execute('UPDATE orders SET status="pending_payment" WHERE id=?',[id]);
 await pay(id,372500);
 let first=await request(base,{token:supplier(1)}),second=await request(base,{token:supplier(2)});
 assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.total,1);assert.equal(second.data.total,1);
 assert.equal(Number(first.data.orders[0].supplier_total),300000);assert.equal(Number(second.data.orders[0].supplier_total),200000);
 const detail=await request(base+'/'+id,{token:supplier(1)});
 assert.equal(detail.data.items.length,1);assert.equal(detail.data.items[0].code,'TEST-10');assert.equal(detail.data.items[0].description,'کالای آزمایشی الف');assert.equal(Number(detail.data.items[0].supplier_price),100000);
 const detail2=await request(base+'/'+id,{token:supplier(2)});assert.equal(detail2.data.items.length,1);assert.equal(detail2.data.items[0].code,'TEST-11');
 for(const key of ['user_id','user_name','user_phone','address','total','approved_amount','shipping_tracking'])assert.equal(Object.hasOwn(detail.data,key),false,key+' must not leak');
 assert.equal((await request(base+'?supplier_id=2',{token:supplier(1)})).data.orders[0].supplier_total,first.data.orders[0].supplier_total);
 for(const token of [null,buyer,manager,supplier(3)])assert.ok([401,403].includes((await request(base,{token})).status));
 assert.equal((await request(base+'/not-a-number',{token:supplier(1)})).status,400);
 assert.equal((await request(base+'?page=-1',{token:supplier(1)})).status,400);
 assert.equal((await request(base+'?status=pending_payment',{token:supplier(1)})).status,400);
 assert.equal((await request(base+'?page=2',{token:supplier(1)})).data.orders.length,0);
 assert.equal((await request(base+'/900',{token:supplier(1)})).status,404);
 const [[legacy]]=await pool.execute('SELECT * FROM order_items WHERE order_id=900');assert.equal(legacy.supplier_id,null);assert.equal(Number(legacy.cost_price),100000);assert.equal(legacy.car_name,'خودروی قدیمی');
 const migration=await fs.readFile(path.join(__dirname,'../migrations/023_order_item_supplier_snapshot.sql'),'utf8');await admin.query(migration);await admin.query(migration);
 // An order solely owned by supplier two is not accessible to supplier one.
 const own2=await request('/api/orders',{method:'POST',body:{items:[{product_id:11,quantity:1}]}});assert.equal(own2.status,201);const id2=own2.data.id;
 await pool.execute('UPDATE orders SET status="pending_payment",debt_remaining=total WHERE id=?',[id2]);await pay(id2,210000);
 assert.equal((await request(base+'/'+id2,{token:supplier(1)})).status,404);
 assert.equal((await request(base+'/'+id2,{token:supplier(2)})).status,200);
 // No real supplier purchase price: do not mislabel the fallback selling price as earnings.
 const unknown=await request('/api/orders',{method:'POST',body:{items:[{product_id:12,quantity:1},{product_id:13,quantity:1}]}});assert.equal(unknown.status,201);const id3=unknown.data.id;
 await pool.execute('UPDATE orders SET status="pending_payment",debt_remaining=total WHERE id=?',[id3]);await pay(id3,130000);
 const missing=await request(base+'/'+id3,{token:supplier(1)});assert.equal(missing.status,200);assert.equal(missing.data.items.length,1);assert.equal(missing.data.items[0].supplier_price,null);assert.equal(missing.data.supplier_total,null);
 await pool.execute('UPDATE orders SET status="cancelled" WHERE id=?',[id]);assert.equal((await request(base+'?status=cancelled',{token:supplier(1)})).data.orders[0].status,'cancelled');

 const manual=await request('/api/orders/manual',{method:'POST',token:manager,body:{user_id:101,items:[{product_id:11,qty:2,price:210000,discount:10}],overall_discount:5,total:1,status:'pending_expert'}});
 assert.equal(manual.status,201,JSON.stringify(manual.data));assert.equal(manual.data.total,359100);
 const [[manualLine]]=await pool.execute('SELECT * FROM order_items WHERE order_id=?',[manual.data.id]);assert.equal(manualLine.supplier_id,2);assert.equal(Number(manualLine.cost_price),200000);assert.equal(manualLine.snapshot_code,'TEST-11');
 await pool.execute('UPDATE orders SET status="pending_payment",debt_remaining=total WHERE id=?',[manual.data.id]);await pay(manual.data.id,359100);
 assert.equal((await request(base+'/'+manual.data.id,{token:supplier(1)})).status,404);
 assert.equal((await request(base+'/'+manual.data.id,{token:supplier(2)})).data.items.length,1);
 const badManual=await request('/api/orders/manual',{method:'POST',token:manager,body:{user_id:101,items:[{desc:'unlinked',qty:1,price:10}],total:10}});assert.equal(badManual.status,400);
 // Failure on the second insert must roll back the header and first snapshot too.
 const [[before]]=await pool.query('SELECT COUNT(*) n FROM orders');
 const failed=await request('/api/orders/manual',{method:'POST',token:manager,body:{user_id:101,items:[{product_id:11,qty:1,price:210000},{product_id:999999,qty:1,price:1}]}});assert.equal(failed.status,400);
 const [[after]]=await pool.query('SELECT COUNT(*) n FROM orders');assert.equal(after.n,before.n);

 await admin.query("CREATE TRIGGER test_snapshot_failure BEFORE INSERT ON order_items FOR EACH ROW BEGIN IF NEW.product_id=13 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated snapshot failure'; END IF; END");
 const [[beforeHeaders]]=await pool.query('SELECT COUNT(*) n FROM orders'),[[beforeLines]]=await pool.query('SELECT COUNT(*) n FROM order_items');
 const failedInsert=await request('/api/orders',{method:'POST',body:{items:[{product_id:11,quantity:1},{product_id:13,quantity:1}]}});assert.equal(failedInsert.status,400);
 const [[afterHeaders]]=await pool.query('SELECT COUNT(*) n FROM orders'),[[afterLines]]=await pool.query('SELECT COUNT(*) n FROM order_items');assert.equal(afterHeaders.n,beforeHeaders.n);assert.equal(afterLines.n,beforeLines.n);
 await admin.query('DROP TRIGGER test_snapshot_failure');
 // Editing a legacy row must not invent an owner from the current catalog.
 await pool.execute('UPDATE orders SET status="pending_expert" WHERE id=900');
 const legacyEdit=await request('/api/orders/900/items',{method:'PUT',token:manager,body:{items:[{product_id:10,quantity:1,price:105000}]}});assert.equal(legacyEdit.status,200);
 const [[legacyAfter]]=await pool.query('SELECT supplier_id,cost_price FROM order_items WHERE order_id=900');assert.equal(legacyAfter.supplier_id,null);assert.equal(Number(legacyAfter.cost_price),100000);
 t.diagnostic('MySQL '+(await pool.query('SELECT VERSION() v'))[0][0].v+': migration replay, old-order exclusion, mixed suppliers, authenticated isolation, immutable snapshots, partial/full payment and unknown cost passed; no wallet or settlement tables added.');
});
