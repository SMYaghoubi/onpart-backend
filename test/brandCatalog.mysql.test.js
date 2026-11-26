const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {load}=require('./supplierImages.fixture.cjs');
test('managed brands and logos: real isolated MySQL, registration, supplier request, review and product entry',{skip:process.env.ONPART_BRAND_TEST_MYSQL!=='1'},async t=>{
 const mysql=require('mysql2/promise'),express=require('express'),jwt=require('jsonwebtoken'),sharp=require('sharp');
 const settings={host:'127.0.0.1',port:33078,user:'root',password:'',charset:'utf8mb4',multipleStatements:true};
 const admin=await mysql.createConnection(settings),[[identity]]=await admin.query('SELECT @@server_id server_id');
 if(Number(identity.server_id)!==760023){await admin.end();throw Error('Refusing nonisolated database');}
 const name='onpart_brand_test_'+randomUUID().replace(/-/g,''),uploads=await fs.mkdtemp(path.join(os.tmpdir(),'onpart-brands-'));
 let pool,server;
 t.after(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool?.end();await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();await fs.rm(uploads,{recursive:true,force:true});});
 let schema=await fs.readFile(path.join(__dirname,'../config/schema.sql'),'utf8');schema=schema.replace(/CREATE DATABASE IF NOT EXISTS onpart /,'CREATE DATABASE '+name+' ').replace('USE onpart;','USE '+name+';');await admin.query(schema);
 for(const file of (await fs.readdir(path.join(__dirname,'../migrations'))).filter(f=>/^\d+.*\.sql$/.test(f)&&Number(f.slice(0,3))<26).sort())await admin.query(await fs.readFile(path.join(__dirname,'../migrations',file),'utf8'));
 pool=mysql.createPool({...settings,database:name,multipleStatements:false,connectionLimit:10});
 const dbFile=require.resolve('../config/database');require.cache[dbFile]={id:dbFile,filename:dbFile,loaded:true,exports:pool};
 process.env.UPLOAD_PATH=uploads;process.env.JWT_SECRET='isolated-brands-secret';require('../lib/uploadStorage').resetUploadStorageForTests();
 await pool.execute('INSERT INTO users (id,name,phone,role,status) VALUES (9,"Manager","09000000009","admin","active"),(8,"Partner","09000000008","partner","active"),(101,"Buyer","09000000101","user","active")');
 for(const id of [1,2]){await pool.execute('INSERT INTO suppliers (id,company,name,mobile,city,status,portal_enabled,brands) VALUES (?,?,?,?,"شهریار","approved",1,"LegacyBrand")',[id,'Private company '+id,'Private name '+id,'0900000000'+id]);await pool.execute('INSERT INTO supplier_product_scopes (supplier_id,scope_type,scope_value) VALUES (?,"brand","LegacyBrand")',[id]);}
 await pool.execute('INSERT INTO products (id,code,description,brand,price,stock) VALUES (10,"LEGACY-10","Legacy product","LegacyBrand",10000,1)');
 const auth=load('middleware/auth.js',{'../config/database':pool}),common={'../config/database':pool,'../middleware/auth':auth,'../config/notif':{createNotif:async()=>{}},'../config/sms':new Proxy({},{get:()=>async()=>{}}),'../lib/adminNotifications':{resolveAdminNotification:async()=>{},notifyAdminNotificationsChanged:()=>{}}};
 const app=express();app.use(express.json());app.use('/api/brands',load('routes/brands.js',common));app.use('/api/supplier-portal',load('routes/supplierBrandRequests.js',common),load('routes/supplierPortal.js',common));app.use('/api/suppliers',load('routes/suppliers.js',common));
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const url='http://127.0.0.1:'+server.address().port;
 const manager=jwt.sign({id:9,role:'admin',context:'management'},process.env.JWT_SECRET),partner=jwt.sign({id:8,role:'partner',context:'management'},process.env.JWT_SECRET),buyer=jwt.sign({id:101,role:'user',context:'shop'},process.env.JWT_SECRET),seller=id=>jwt.sign({supplier_id:id,role:'supplier'},process.env.JWT_SECRET);
 async function request(p,{token=manager,method='GET',body}={}){const form=body instanceof FormData;const r=await fetch(url+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(!form&&body?{'Content-Type':'application/json'}:{})},body:form?body:body?JSON.stringify(body):undefined});return {status:r.status,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.text()};}
 const ok=(r,status=200)=>assert.equal(r.status,status,JSON.stringify(r.data));
 let brandId,otherId,requestId;
 await t.test('catalog seeds legacy once; only manager creates independent and featured brands',async()=>{
  const publicList=await request('/api/brands/registration',{token:null});ok(publicList);assert.equal(publicList.data.brands[0].name,'LegacyBrand');assert.deepEqual(Object.keys(publicList.data.brands[0]).sort(),['featured','id','logo_url','name']);
  for(const token of [partner,seller(1),buyer,null])assert.ok([401,403].includes((await request('/api/brands',{token,method:'POST',body:{name:'Unauthorized'}})).status));
  const added=await request('/api/brands',{method:'POST',body:{name:'برند منتخب آزمایشی',featured:true}});ok(added,201);brandId=added.data.id;
  const other=await request('/api/brands',{method:'POST',body:{name:'برند دوم آزمایشی'}});ok(other,201);otherId=other.data.id;
  ok(await request('/api/brands',{method:'POST',body:{name:'برند منتخب آزمایشی'}}),409);
  ok(await request('/api/brands',{method:'POST',body:{name:'نام،لیست'}}),400);
  assert.equal((await request('/api/brands/registration',{token:null})).data.brands[0].id,brandId);
  const scope=await request('/api/supplier-portal/admin/scope-options');ok(scope);assert.equal(Number(scope.data.brands.find(row=>row.brand==='برند منتخب آزمایشی').product_count),0);
  await pool.execute('INSERT INTO products (code,description,brand,price,stock) VALUES ("LATE","Late product","UnmanagedBrand",1,1)');
  assert.equal((await request('/api/brands/registration',{token:null})).data.brands.some(row=>row.name==='UnmanagedBrand'),false);
 });
 await t.test('supplier chooses catalog IDs, pending request grants nothing; private history and idempotency',async()=>{
  const own=await request('/api/supplier-portal/brands',{token:seller(1)});ok(own);assert.equal(own.data.brands.find(row=>row.id===brandId).approved,false);
  const key=randomUUID(),body={brand_ids:[brandId],request_key:key};let r=await request('/api/supplier-portal/brand-requests',{token:seller(1),method:'POST',body});ok(r,201);requestId=r.data.id;
  const [scopes]=await pool.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=1');assert.deepEqual(scopes.map(row=>row.scope_value),['LegacyBrand']);
  r=await request('/api/supplier-portal/brand-requests',{token:seller(1),method:'POST',body});ok(r);assert.equal(r.data.id,requestId);
  ok(await request('/api/supplier-portal/brand-requests',{token:seller(1),method:'POST',body:{brand_ids:[otherId],request_key:key}}),409);
  ok(await request('/api/supplier-portal/brand-requests',{token:seller(1),method:'POST',body:{brand_ids:[otherId],request_key:randomUUID()}}),409);
  assert.equal((await request('/api/supplier-portal/brands',{token:seller(2)})).data.requests.length,0);
  const ownAgain=await request('/api/supplier-portal/brands',{token:seller(1)});assert.doesNotMatch(JSON.stringify(ownAgain.data),/Private company|supplier_id|0900000000/);
  ok(await request('/api/brands/'+brandId,{method:'DELETE'}),409);
  ok(await request('/api/brands/'+brandId,{method:'PATCH',body:{name:'renamed-used'}}),409);
 });
 await t.test('review is additive, authenticated and idempotent; zero-product brand available in product entry',async()=>{
  const endpoint='/api/supplier-portal/admin/brand-requests/'+requestId+'/review';
  ok(await request(endpoint,{token:seller(1),method:'POST',body:{decision:'approve'}}),403);
  ok(await request(endpoint,{method:'POST',body:{decision:'approve'}}));ok(await request(endpoint,{method:'POST',body:{decision:'approve'}}));
  ok(await request(endpoint,{method:'POST',body:{decision:'reject'}}),409);
  const own=await request('/api/supplier-portal/products',{token:seller(1)});ok(own);assert.ok(own.data.brands.includes('LegacyBrand'));assert.ok(own.data.brands.includes('برند منتخب آزمایشی'));
  const submitted=await request('/api/supplier-portal/updates',{token:seller(1),method:'POST',body:{request_key:randomUUID(),items:[{new_product:true,code:'ZERO-NEW',description:'کالای آزمایشی بدون سابقه',brand:'برند منتخب آزمایشی',supplier_price:10000,quantity:2,available:true}]}});ok(submitted,201);
  const [[before]]=await pool.execute('SELECT COUNT(*) total FROM products WHERE code="ZERO-NEW"');assert.equal(before.total,0);
  ok(await request('/api/supplier-portal/admin/updates/'+submitted.data.id+'/approve',{method:'POST',body:{markup_percent:5}}));
  const [[created]]=await pool.execute('SELECT brand FROM products WHERE code="ZERO-NEW"');assert.equal(created.brand,'برند منتخب آزمایشی');
  const [[declared]]=await pool.execute('SELECT brands FROM suppliers WHERE id=1');assert.ok(declared.brands.includes('برند منتخب آزمایشی'));
 });
 await t.test('rejected or disabled choices never grant permission; existing scopes survive',async()=>{
  const r=await request('/api/supplier-portal/brand-requests',{token:seller(1),method:'POST',body:{brand_ids:[otherId],request_key:randomUUID()}});ok(r,201);
  ok(await request('/api/brands/'+otherId,{method:'PATCH',body:{active:false}}));
  ok(await request('/api/supplier-portal/admin/brand-requests/'+r.data.id+'/review',{method:'POST',body:{decision:'approve'}}),409);
  ok(await request('/api/supplier-portal/admin/brand-requests/'+r.data.id+'/review',{method:'POST',body:{decision:'reject',note:'آزمایش رد'}}));
  ok(await request('/api/supplier-portal/brand-requests',{token:seller(2),method:'POST',body:{brand_ids:[otherId],request_key:randomUUID()}}),409);
  const [scopes]=await pool.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=1');assert.equal(scopes.length,2);
  ok(await request('/api/brands/'+brandId,{method:'PATCH',body:{active:false}}));assert.equal((await request('/api/supplier-portal/products',{token:seller(1)})).data.brands.includes('برند منتخب آزمایشی'),false);
  const [unchanged]=await pool.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=1');assert.equal(unchanged.length,2);
  ok(await request('/api/brands/'+brandId,{method:'PATCH',body:{active:true}}));
 });
 await t.test('registration canonicalizes IDs and remains pending until general management approval',async()=>{
  const body={company:'Application test',name:'Applicant',mobile:'09000000333',city:'شهریار',brand_ids:[brandId],brands:'ForgedName',status:'approved',portal_enabled:1};
  const r=await request('/api/suppliers',{token:null,method:'POST',body});ok(r,201);
  const [[saved]]=await pool.execute('SELECT status,portal_enabled,brands FROM suppliers WHERE id=?',[r.data.id]);assert.equal(saved.status,'pending');assert.equal(Number(saved.portal_enabled),0);assert.equal(saved.brands,'برند منتخب آزمایشی');
  ok(await request('/api/suppliers/'+r.data.id+'/approve',{method:'PATCH',body:{expected_brands:saved.brands,confirm_brands:true}}));
  const [scopes]=await pool.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=?',[r.data.id]);assert.deepEqual(scopes.map(row=>row.scope_value),['برند منتخب آزمایشی']);
  ok(await request('/api/suppliers',{token:null,method:'POST',body:{...body,mobile:'09000000334',brand_ids:[999999]}}),409);
 });
 await t.test('manager-only decoded logos: upload, display, replace, rollback, remove and input validation',async()=>{
  const png=await sharp({create:{width:80,height:45,channels:4,background:'#2351dd'}}).png().toBuffer();
  const form=(buffer=png,type='image/png')=>{const body=new FormData();body.append('logo',new Blob([buffer],{type}),'test.png');return body;};
  const endpoint='/api/brands/'+brandId+'/logo';
  ok(await request(endpoint,{token:seller(1),method:'POST',body:form()}),403);ok(await request(endpoint,{token:partner,method:'POST',body:form()}),403);
  let r=await request(endpoint,{method:'POST',body:form()});ok(r,201);assert.match(r.data.logo_url,/\/api\/brands\/\d+\/logo\?v=/);
  const publicLogo=await fetch(url+endpoint);assert.equal(publicLogo.status,200);assert.match(publicLogo.headers.get('content-type'),/image\/webp/);const metadata=await sharp(Buffer.from(await publicLogo.arrayBuffer())).metadata();assert.equal(metadata.format,'webp');
  const list=await request('/api/brands/registration',{token:null});assert.equal(list.data.brands.find(row=>row.id===brandId).logo_url,r.data.logo_url);
  const firstFiles=await fs.readdir(path.join(uploads,'.brand-logos'));assert.equal(firstFiles.length,1);
  ok(await request(endpoint,{method:'POST',body:form(Buffer.from('<svg></svg>'),'image/png')}),400);
  ok(await request(endpoint,{method:'POST',body:form(Buffer.alloc(2*1024*1024+1),'image/png')}),400);
  await pool.query("CREATE TRIGGER fail_brand_logo BEFORE UPDATE ON brand_catalog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test logo rollback'");
  ok(await request(endpoint,{method:'POST',body:form()}),500);assert.deepEqual(await fs.readdir(path.join(uploads,'.brand-logos')),firstFiles);await pool.query('DROP TRIGGER fail_brand_logo');
  ok(await request(endpoint,{method:'POST',body:form()}),201);const nextFiles=await fs.readdir(path.join(uploads,'.brand-logos'));assert.equal(nextFiles.length,1);assert.notEqual(nextFiles[0],firstFiles[0]);
  ok(await request(endpoint,{method:'DELETE'}));assert.equal((await fetch(url+endpoint)).status,404);assert.equal((await fs.readdir(path.join(uploads,'.brand-logos'))).length,0);
 });
 await t.test('unused brand rename/delete allowed, pending applications protected; failed review rolls back',async()=>{
  const r=await request('/api/brands',{method:'POST',body:{name:'Unused'}});ok(r,201);ok(await request('/api/brands/'+r.data.id,{method:'PATCH',body:{name:'Unused renamed'}}));
  await request('/api/suppliers',{token:null,method:'POST',body:{company:'Pending test',name:'Pending',mobile:'09000000335',city:'شهریار',brand_ids:[r.data.id]}});
  ok(await request('/api/brands/'+r.data.id,{method:'DELETE'}),409);
  const fresh=await request('/api/brands',{method:'POST',body:{name:'Delete unused'}});ok(fresh,201);ok(await request('/api/brands/'+fresh.data.id,{method:'DELETE'}));
  const body={brand_ids:[brandId],request_key:randomUUID()},pending=await request('/api/supplier-portal/brand-requests',{token:seller(2),method:'POST',body});ok(pending,201);
  await pool.query("CREATE TRIGGER fail_brand_review BEFORE INSERT ON supplier_product_scopes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test review rollback'");
  ok(await request('/api/supplier-portal/admin/brand-requests/'+pending.data.id+'/review',{method:'POST',body:{decision:'approve'}}),500);
  const [[result]]=await pool.execute('SELECT status FROM supplier_brand_requests WHERE id=?',[pending.data.id]);assert.equal(result.status,'pending');const [scopes]=await pool.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=2');assert.deepEqual(scopes.map(row=>row.scope_value),['LegacyBrand']);await pool.query('DROP TRIGGER fail_brand_review');
 });
});
