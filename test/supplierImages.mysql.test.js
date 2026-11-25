const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {load}=require('./supplierImages.fixture.cjs');
test('supplier photo lifecycle against a disposable local MySQL schema', {skip:process.env.ONPART_DISPOSABLE_MYSQL!=='1'},async t=>{
  const mysql=require('mysql2/promise'),express=require('express'),jwt=require('jsonwebtoken'),sharp=require('sharp');
  // Only the explicitly identified disposable loopback server is accepted.
  // No DB_HOST, DB_PASS, environment database URL, or production pool is used.
  const settings={host:'127.0.0.1',port:33077,user:'root',password:'',charset:'utf8mb4',multipleStatements:true};
  const admin=await mysql.createConnection(settings);
  const [[identity]]=await admin.query('SELECT @@server_id server_id');
  if(Number(identity.server_id)!==750033){await admin.end();throw new Error('This is not the disposable photo test server');}
  const name='onpart_photo_test_'+randomUUID().replace(/-/g,'');
  let pool,server;const uploads=await fs.mkdtemp(path.join(os.tmpdir(),'onpart-mysql-photo-'));
  t.after(async()=>{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await pool?.end();await admin.query('DROP DATABASE IF EXISTS \`'+name+'\`');await admin.end();
    await fs.rm(uploads,{recursive:true,force:true});
  });
  let schema=await fs.readFile(path.join(__dirname,'../config/schema.sql'),'utf8');
  schema=schema.replace(/CREATE DATABASE IF NOT EXISTS onpart /,'CREATE DATABASE '+name+' ').replace('USE onpart;','USE '+name+';');
  await admin.query(schema);
  for(const p of ['004_create_supplier_portal.sql','008_add_supplier_update_errors.sql','010_archive_supplier_batches.sql'])await admin.query(await fs.readFile(path.join(__dirname,'../migrations',p),'utf8'));
  pool=mysql.createPool({...settings,database:name,multipleStatements:false,connectionLimit:5});
  process.env.NODE_ENV='test';process.env.UPLOAD_PATH=uploads;process.env.JWT_SECRET='disposable-mysql-photo-test';
  const {resetUploadStorageForTests}=require('../lib/uploadStorage');resetUploadStorageForTests();
  const {photoStore,approvedPhotoGuard}=require('../lib/supplierImages');
  await photoStore(pool).ready();
  await pool.execute('INSERT INTO users (id,name,phone,role,status) VALUES (9,?,?,?,?)',['test admin','09000000009','admin','active']);
  for(const id of [1,2]){await pool.execute('INSERT INTO suppliers (id,company,name,mobile,status,portal_enabled) VALUES (?,?,?,?,?,1)',[id,'test supplier '+id,'test','0900000000'+id,'approved']);await pool.execute('INSERT INTO supplier_product_scopes (supplier_id,scope_type,scope_value) VALUES (?,"brand",?)',[id,'خاتم']);}
  await pool.execute('INSERT INTO products (id,code,description,brand,price,stock,image) VALUES (10,?,?,?,?,?,?)',['EX-10','test existing','خاتم',70000,1,'/uploads/previous.webp']);
  await pool.execute('INSERT INTO supplier_inventory (supplier_id,product_id,quantity,available,supplier_price) VALUES (1,10,8,1,60000)');
  const auth=load('middleware/auth.js',{'../config/database':pool});
  const shared={'../config/database':pool,'../middleware/auth':auth};
  const images=load('routes/supplierImages.js',shared);
  const portal=load('routes/supplierPortal.js',{...shared,'../config/sms':{},'../config/notif':{createNotif:async()=>{}},'../lib/adminNotifications':{resolveAdminNotification:async()=>{},notifyAdminNotificationsChanged:()=>{}}});
  const app=express();app.use(express.json());app.use('/api/supplier-portal',images,portal);
  const {isPrivateUploadPath}=require('../lib/privateDocuments');
  app.use('/uploads',(req,res,next)=>isPrivateUploadPath(req.path)?res.sendStatus(404):next(),approvedPhotoGuard(pool),express.static(uploads));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url='http://127.0.0.1:'+server.address().port;
  const supplier=id=>jwt.sign({role:'supplier',supplier_id:id},process.env.JWT_SECRET),manager=jwt.sign({id:9,role:'admin',context:'management'},process.env.JWT_SECRET);
  const request=async(p,{token=supplier(1),method='GET',body}={})=>{
    const r=await fetch(url+'/api/supplier-portal'+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    return {status:r.status,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.arrayBuffer()};
  };
  const png=await sharp({create:{width:60,height:40,channels:3,background:'#fff'}}).png().toBuffer();
  const upload=async()=>{const body=new FormData();body.append('brand','خاتم');body.append('image',new Blob([png],{type:'image/png'}),'test.png');const r=await request('/images',{method:'POST',body});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.id;};
  const submit=async(items,token)=>request('/updates',{method:'POST',token,body:{items,request_key:randomUUID()}});
  const photo=await upload();
  assert.equal((await request('/images/'+photo,{token:supplier(2)})).status,404);
  const batch=await submit([{new_product:true,code:'NEW-1',description:'test new','brand':'خاتم',supplier_price:50000,quantity:4,available:true,image_id:photo}]);assert.equal(batch.status,201,JSON.stringify(batch.data));
  const [[pendingCount]]=await pool.query('SELECT COUNT(*) count FROM products WHERE code="NEW-1"');assert.equal(pendingCount.count,0);
  const pending=await request('/products');assert.equal(pending.status,200,JSON.stringify(pending.data));assert.equal(pending.data.pending_products[0].image_id,photo);
  const history=await request('/updates/'+batch.data.id);assert.equal(history.status,200,JSON.stringify(history.data));assert.equal(history.data.items[0].image_id,photo);
  const review=await request('/admin/updates/'+batch.data.id,{token:manager});assert.equal(review.status,200,JSON.stringify(review.data));assert.equal(review.data.newItems[0].image_id,photo);
  const approval=await request('/admin/updates/'+batch.data.id+'/approve',{token:manager,method:'POST',body:{markup_percent:5}});assert.equal(approval.status,200,JSON.stringify(approval.data));
  const [[product]]=await pool.execute('SELECT * FROM products WHERE code=?',['NEW-1']);assert.equal(Number(product.price),52500);assert.equal(product.image,'/uploads/productphoto_'+photo+'.webp');
  assert.equal((await fetch(url+product.image)).status,200);
  const replacement=await upload(),old=await submit([{product_id:10,code:'EX-10',image_id:replacement}]);assert.equal(old.status,201,JSON.stringify(old.data));
  const existingReview=await request('/admin/updates/'+old.data.id,{token:manager});assert.equal(existingReview.status,200,JSON.stringify(existingReview.data));assert.equal(existingReview.data.items[0].image_id,replacement);
  const reject=await request('/admin/updates/'+old.data.id+'/reject',{token:manager,method:'POST',body:{note:'test rejected'}});assert.equal(reject.status,200,JSON.stringify(reject.data));
  const [[existing]]=await pool.execute('SELECT image,price FROM products WHERE id=10');assert.equal(existing.image,'/uploads/previous.webp');assert.equal(Number(existing.price),70000);
  assert.equal((await fetch(url+'/uploads/productphoto_'+replacement+'.webp')).status,404);
  const latest=await upload(),imageOnly=await submit([{product_id:10,code:'EX-10',image_id:latest}]);assert.equal(imageOnly.status,201,JSON.stringify(imageOnly.data));
  assert.equal((await request('/admin/updates/'+imageOnly.data.id+'/approve',{token:manager,method:'POST',body:{markup_percent:99}})).status,200);
  const [[unchanged]]=await pool.execute('SELECT p.price,si.supplier_price,si.quantity FROM products p JOIN supplier_inventory si ON si.product_id=p.id AND si.supplier_id=1 WHERE p.id=10');
  assert.equal(Number(unchanged.price),70000);assert.equal(Number(unchanged.supplier_price),60000);assert.equal(unchanged.quantity,8);
  const foreign=await upload(),unauthorized=await submit([{new_product:true,code:'BAD',description:'test','brand':'خاتم',supplier_price:50000,quantity:1,available:true,image_id:foreign}],supplier(2));
  assert.equal(unauthorized.status,400);
  const [[rolledBack]]=await pool.execute('SELECT COUNT(*) count FROM supplier_new_product_requests WHERE code=?',['BAD']);assert.equal(rolledBack.count,0);
  t.diagnostic('MySQL '+(await pool.query('SELECT VERSION() version'))[0][0].version+'; migration, joins, new-product approval, photo-only approval, rejection and ownership passed');
});

