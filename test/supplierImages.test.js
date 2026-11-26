const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const express=require('express'),jwt=require('jsonwebtoken'),sharp=require('sharp');
const {load,database}=require('./supplierImages.fixture.cjs');
const {photoStore,prepareImage,MAX_IMAGE_BYTES,approvedPhotoGuard}=require('../lib/supplierImages');
const {isPrivateUploadPath}=require('../lib/privateDocuments');
const {resetUploadStorageForTests}=require('../lib/uploadStorage');
process.env.JWT_SECRET='local-supplier-images-test-key';
const supplierToken=id=>jwt.sign({role:'supplier',supplier_id:id},process.env.JWT_SECRET);
const adminToken=jwt.sign({id:9,role:'admin',context:'management'},process.env.JWT_SECRET);
const buyerToken=jwt.sign({id:8,role:'user',context:'shop'},process.env.JWT_SECRET);
let jpeg;
test.before(async()=>{jpeg=await sharp({create:{width:40,height:30,channels:3,background:'#fff'}}).jpeg().toBuffer();});
async function setup(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'onpart-photos-'));
  process.env.UPLOAD_PATH=directory;process.env.NODE_ENV='test';resetUploadStorageForTests();
  const fixture=database(),auth=load('middleware/auth.js',{'../config/database':fixture.db});
  const common={'../config/database':fixture.db,'../middleware/auth':auth};
  const images=load('routes/supplierImages.js',common);
  const portal=load('routes/supplierPortal.js',{...common,'../lib/marketplace':{...require('../lib/marketplace'),marketplaceSchema:()=>async()=>{},publishOffer:async()=>{}},'../config/sms':{},'../config/notif':{createNotif:async()=>{}},'../lib/adminNotifications':{resolveAdminNotification:async()=>{},notifyAdminNotificationsChanged:()=>{}}});
  const app=express();app.use(express.json());app.use('/api/supplier-portal',images,portal);
  app.use('/uploads',(req,res,next)=>isPrivateUploadPath(req.path)?res.sendStatus(404):next(),approvedPhotoGuard(fixture.db),express.static(directory));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port;
  const request=(p,{token=supplierToken(1),body,method='GET'}={})=>fetch(base+p,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  const upload=async({token=supplierToken(1),buffer=jpeg,type='image/jpeg',brand='خاتم'}={})=>{
    const body=new FormData();body.append('brand',brand);body.append('image',new Blob([buffer],{type}),'test.jpg');
    const res=await request('/api/supplier-portal/images',{method:'POST',token,body});return {res,data:await res.json()};
  };
  const submit=async(image_id,{token=supplierToken(1),existing=false,key}={})=>{
    const item=existing?{product_id:10,code:'EX-10',image_id}:{new_product:true,code:'TEST-NEW',description:'کالای آزمایشی',brand:'خاتم',supplier_price:50000,quantity:4,available:true,...(image_id?{image_id}:{})};
    const res=await request('/api/supplier-portal/updates',{method:'POST',token,body:{items:[item],...(key?{request_key:key}:{})}});return {res,data:await res.json()};
  };
  const approve=batch=>request('/api/supplier-portal/admin/updates/'+batch+'/approve',{method:'POST',token:adminToken,body:{markup_percent:5}});
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(directory,{recursive:true,force:true});});
  return {...fixture,request,upload,submit,approve,directory,store:photoStore(fixture.db)};
}
test('decodes real photos, strips metadata, and rejects fake MIME, active files, oversize and truncated data',async()=>{
  const output=await prepareImage(jpeg,'image/jpeg'),meta=await sharp(output).metadata();
  assert.equal(meta.format,'webp');assert.equal(meta.width,40);assert.equal(meta.exif,undefined);
  const oriented=await sharp(jpeg).withMetadata({orientation:6}).jpeg().toBuffer();
  assert.ok((await sharp(oriented).metadata()).exif);
  const rotated=await sharp(await prepareImage(oriented,'image/jpeg')).metadata();
  assert.equal(rotated.width,30);assert.equal(rotated.height,40);assert.equal(rotated.exif,undefined);
  await assert.rejects(prepareImage(Buffer.from('<svg><script/></svg>'),'image/jpeg'));
  await assert.rejects(prepareImage(jpeg,'image/png'));
  await assert.rejects(prepareImage(Buffer.alloc(MAX_IMAGE_BYTES+1),'image/jpeg'));
  await assert.rejects(prepareImage(jpeg.subarray(0,12),'image/jpeg'));
  const large=await sharp({create:{width:6000,height:5000,channels:3,background:'#fff'}}).png().toBuffer();
  await assert.rejects(prepareImage(large,'image/png'));
});
test('upload and read require approved supplier or management; another supplier and buyer cannot read',async t=>{
  const e=await setup(t);
  assert.equal((await e.upload({token:null})).res.status,401);
  assert.equal((await e.upload({token:supplierToken(3)})).res.status,403);
  assert.equal((await e.upload({brand:'خارج از دسترسی'})).res.status,403);
  assert.equal((await e.upload({type:'image/jpeg',buffer:Buffer.from('<svg/>')})).res.status,400);
  const {res,data}=await e.upload();assert.equal(res.status,201,JSON.stringify(data));
  assert.equal((await e.request('/api/supplier-portal/images/'+data.id)).status,200);
  assert.equal((await e.request('/api/supplier-portal/images/'+data.id,{token:supplierToken(2)})).status,404);
  assert.equal((await e.request('/api/supplier-portal/admin/images/'+data.id,{token:buyerToken})).status,403);
  assert.equal((await e.request('/api/supplier-portal/admin/images/'+data.id,{token:adminToken})).status,200);
  assert.equal((await e.request('/uploads/supplierphoto_'+data.id+'.webp',{token:null})).status,404);
  assert.equal((await e.request('/uploads/.supplier-product-images/supplierphoto_'+data.id+'.webp',{token:null})).status,404);
});
test('new product and photo stay private until management approves; approval keeps existing pricing logic and idempotency',async t=>{
  const e=await setup(t),{data:photo}=await e.upload();
  const key='11111111-1111-4111-8111-111111111111';
  const batch=await e.submit(photo.id,{key});assert.equal(batch.res.status,201,JSON.stringify(batch.data));
  assert.equal(e.state.products.length,1);assert.equal(e.state.photos[0].state,'pending');
  const repeat=await e.submit(photo.id,{key});assert.equal(repeat.res.status,200);assert.equal(repeat.data.id,batch.data.id);assert.equal(e.state.newItems.length,1);
  assert.equal((await e.request('/uploads/productphoto_'+photo.id+'.webp',{token:null})).status,404);
  assert.equal((await e.request('/api/supplier-portal/images/'+photo.id,{method:'DELETE'})).status,409);
  const response=await e.approve(batch.data.id);assert.equal(response.status,200,await response.text());
  const product=e.state.products.find(p=>p.code==='TEST-NEW');assert.equal(product.price,52500);assert.equal(product.quantity,4);
  assert.equal(product.image,'/uploads/productphoto_'+photo.id+'.webp');assert.equal(e.state.photos[0].state,'approved');
  assert.equal((await e.request(product.image,{token:null})).status,200);
  assert.equal((await e.approve(batch.data.id)).status,400);
});
test('cross-account attachment rolls the whole submission back and image-only changes preserve prices',async t=>{
  const e=await setup(t),{data:photo}=await e.upload();
  const bad=await e.submit(photo.id,{token:supplierToken(2)});assert.equal(bad.res.status,400);assert.equal(e.state.batches.length,0);assert.equal(e.state.photos[0].state,'draft');
  const batch=await e.submit(photo.id,{existing:true});assert.equal(batch.res.status,201,JSON.stringify(batch.data));
  const product=e.state.products[0];assert.equal(product.image,'/uploads/existing-photo.webp');
  const approved=await e.approve(batch.data.id);assert.equal(approved.status,200,await approved.text());
  assert.equal(e.state.products[0].price,70000);assert.equal(e.state.products[0].supplier_price,60000);assert.equal(e.state.products[0].quantity,8);
  assert.equal(e.state.products[0].image,'/uploads/productphoto_'+photo.id+'.webp');
});
test('rejection keeps the prior image; failed approval removes copied public files and preserves pending changes',async t=>{
  const e=await setup(t),{data:photo}=await e.upload(),batch=await e.submit(photo.id,{existing:true});
  e.setFailImage(true);assert.equal((await e.approve(batch.data.id)).status,400);e.setFailImage(false);
  assert.equal(e.state.products[0].image,'/uploads/existing-photo.webp');assert.equal(e.state.photos[0].state,'pending');
  assert.equal((await fs.readdir(e.directory)).some(name=>name.startsWith('productphoto_')),false);
  const rejected=await e.request('/api/supplier-portal/admin/updates/'+batch.data.id+'/reject',{method:'POST',token:adminToken,body:{note:'عکس نامرتبط'}});
  assert.equal(rejected.status,200,await rejected.text());assert.equal(e.state.photos[0].state,'rejected');
  assert.equal((await e.request('/uploads/productphoto_'+photo.id+'.webp',{token:null})).status,404);
  assert.equal((await e.request('/api/supplier-portal/images/'+photo.id)).status,200);
});
test('a failed transaction commit exposes no product photo and legacy new-product submissions still work without images',async t=>{
  const e=await setup(t),{data:photo}=await e.upload(),batch=await e.submit(photo.id,{existing:true});
  e.setFailCommit(true);assert.equal((await e.approve(batch.data.id)).status,400);e.setFailCommit(false);
  assert.equal(e.state.photos[0].state,'pending');assert.equal((await fs.readdir(e.directory)).some(n=>n.startsWith('productphoto_')),false);
  const legacy=await e.submit(null);assert.equal(legacy.res.status,201,JSON.stringify(legacy.data));assert.equal((await e.approve(legacy.data.id)).status,200);
  assert.equal(e.state.products.find(p=>p.code==='TEST-NEW').image,null);
});
test('approval retries can safely replace an uncommitted copy left by an interrupted process',async t=>{
  const e=await setup(t),{data:photo}=await e.upload(),batch=await e.submit(photo.id,{existing:true});
  const copied=path.join(e.directory,'productphoto_'+photo.id+'.webp');
  await fs.writeFile(copied,'uncommitted copy');
  assert.equal((await e.request('/uploads/productphoto_'+photo.id+'.webp',{token:null})).status,404);
  assert.equal((await e.approve(batch.data.id)).status,200);
  assert.equal((await sharp(copied).metadata()).format,'webp');
});
test('draft deletion is owner-only and a copied-but-uncommitted photo is blocked by the public guard',async t=>{
  const e=await setup(t),{data:photo}=await e.upload(),row=e.state.photos[0];
  await fs.copyFile(e.store.filePath(row.filename),path.join(e.directory,'productphoto_'+photo.id+'.webp'));
  assert.equal((await e.request('/uploads/productphoto_'+photo.id+'.webp',{token:null})).status,404);
  assert.equal((await e.request('/api/supplier-portal/images/'+photo.id,{method:'DELETE',token:supplierToken(2)})).status,409);
  assert.equal((await e.request('/api/supplier-portal/images/'+photo.id,{method:'DELETE'})).status,200);
  assert.equal(e.state.photos.length,0);await assert.rejects(fs.access(e.store.filePath(row.filename)));
});

