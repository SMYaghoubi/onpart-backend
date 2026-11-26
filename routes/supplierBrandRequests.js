const router=require('express').Router(),db=require('../config/database');
const {supplierAuth,adminAuth}=require('../middleware/auth');
const {createNotif}=require('../config/notif');
const {resolveAdminNotification,notifyAdminNotificationsChanged}=require('../lib/adminNotifications');
const catalog=require('../lib/brandCatalog');
const ensure=catalog.brandCatalogSchema(db);
async function ready(_req,res,next){try{await ensure();next();}catch(error){res.status(503).json({message:'فهرست برندها موقتاً در دسترس نیست'})}}
async function requestRows(conn,where,params){
 const [rows]=await conn.execute(`SELECT r.id,r.supplier_id,r.status,r.note,r.created_at,r.reviewed_at,s.company,c.seller_code FROM supplier_brand_requests r LEFT JOIN suppliers s ON s.id=r.supplier_id LEFT JOIN supplier_seller_codes c ON c.supplier_id=r.supplier_id ${where} ORDER BY r.id DESC LIMIT 100`,params);
 if(!rows.length)return [];
 const [items]=await conn.execute('SELECT i.request_id,b.id,b.name FROM supplier_brand_request_items i JOIN brand_catalog b ON b.id=i.brand_id WHERE i.request_id IN ('+rows.map(()=>'?').join(',')+') ORDER BY b.name',rows.map(row=>row.id));
 return rows.map(row=>({...row,brands:items.filter(item=>item.request_id===row.id).map(({id,name})=>({id,name}))}));
}
router.get('/brands',supplierAuth,ready,async(req,res)=>{
 try{
  const [brands]=await db.execute('SELECT id,name,featured,logo_id FROM brand_catalog WHERE active=1 ORDER BY featured DESC,name');
  const [scopes]=await db.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand"',[req.supplier.id]);
  const requests=await requestRows(db,'WHERE r.supplier_id=?',[req.supplier.id]);
  const approved=scopes.map(scope=>scope.scope_value),pending=new Set(requests.filter(row=>row.status==='pending').flatMap(row=>row.brands.map(brand=>brand.id)));
  res.json({brands:brands.map(row=>({...catalog.withLogo(row),logo_id:undefined,approved:Boolean(catalog.resolveAllowedBrand(row.name,new Set(approved))),pending:pending.has(row.id)})),approved,requests:requests.map(({supplier_id,company,seller_code,...row})=>row)});
 }catch(error){res.status(503).json({message:'دریافت برندهای حساب انجام نشد'})}
});
router.post('/brand-requests',supplierAuth,ready,async(req,res)=>{
 const key=req.body.request_key;
 if(typeof key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))return res.status(400).json({message:'شناسه درخواست نامعتبر است'});
 let conn,committed=false;
 try{
  conn=await db.getConnection();
  await conn.beginTransaction();await conn.execute('SELECT id FROM suppliers WHERE id=? FOR UPDATE',[req.supplier.id]);
  const brands=await catalog.brandsByIds(conn,req.body.brand_ids,true);
  const [[existing]]=await conn.execute('SELECT id,status FROM supplier_brand_requests WHERE supplier_id=? AND request_key=? FOR UPDATE',[req.supplier.id,key]);
  if(existing){
   const [items]=await conn.execute('SELECT brand_id FROM supplier_brand_request_items WHERE request_id=? ORDER BY brand_id',[existing.id]);
   if(JSON.stringify(items.map(row=>row.brand_id))!==JSON.stringify(brands.map(row=>row.id)))throw catalog.fault(409,'شناسه ارسال برای برندهای دیگری استفاده شده است');
   await conn.commit();committed=true;return res.json({id:existing.id,status:existing.status,replayed:true,message:'این درخواست قبلاً ثبت شده است'});
  }
  const [[pending]]=await conn.execute('SELECT id FROM supplier_brand_requests WHERE supplier_id=? AND status="pending" LIMIT 1 FOR UPDATE',[req.supplier.id]);
  if(pending)throw catalog.fault(409,'درخواست برند قبلی هنوز در انتظار بررسی مدیریت است');
  const [scopes]=await conn.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand"',[req.supplier.id]);
  if(brands.some(brand=>catalog.resolveAllowedBrand(brand.name,new Set(scopes.map(row=>row.scope_value)))))throw catalog.fault(400,'فقط برندهایی را انتخاب کنید که هنوز برای حساب شما تأیید نشده‌اند');
  const [request]=await conn.execute('INSERT INTO supplier_brand_requests (supplier_id,request_key) VALUES (?,?)',[req.supplier.id,key]);
  for(const brand of brands)await conn.execute('INSERT INTO supplier_brand_request_items (request_id,brand_id) VALUES (?,?)',[request.insertId,brand.id]);
  await conn.commit();committed=true;
  try{await createNotif('supplier','درخواست برند #'+request.insertId,req.supplier.company+' برندهای فعالیت خود را برای بررسی ارسال کرد','/admin/brands#requests','supplier_brand_request',request.insertId);}catch(error){console.error('Brand request notification:',error.message);}
  res.status(201).json({id:request.insertId,status:'pending',message:'برندهای انتخابی برای تأیید مدیریت ارسال شدند'});
 }catch(error){if(conn&&!committed)await conn.rollback().catch(()=>{});res.status(error.status||500).json({message:error.status?error.message:'ثبت درخواست برند انجام نشد'});}finally{conn?.release();}
});
router.get('/admin/brand-requests',adminAuth,ready,async(req,res)=>{
 const status=req.query.status||'';if(status&&!['pending','approved','rejected'].includes(status))return res.status(400).json({message:'وضعیت نامعتبر است'});
 try{res.json({requests:await requestRows(db,status?'WHERE r.status=?':'',status?[status]:[])});}catch(error){res.status(503).json({message:'دریافت درخواست‌های برند انجام نشد'})}
});
router.post('/admin/brand-requests/:id/review',adminAuth,ready,async(req,res)=>{
 const id=Number(req.params.id),decision=req.body.decision;
 if(!Number.isSafeInteger(id)||id<=0||!['approve','reject'].includes(decision)|| (req.body.note!=null&&typeof req.body.note!=='string'))return res.status(400).json({message:'اطلاعات بررسی نامعتبر است'});
 let conn,committed=false;
 try{
  conn=await db.getConnection();
  await conn.beginTransaction();
  const [[info]]=await conn.execute('SELECT supplier_id FROM supplier_brand_requests WHERE id=?',[id]);if(!info)throw catalog.fault(404,'درخواست یافت نشد');
  const [[supplier]]=await conn.execute('SELECT id,status,portal_enabled,brands FROM suppliers WHERE id=? FOR UPDATE',[info.supplier_id]);
  const [[request]]=await conn.execute('SELECT * FROM supplier_brand_requests WHERE id=? FOR UPDATE',[id]);
  const next=decision==='approve'?'approved':'rejected';
  if(request.status!=='pending'){
   if(request.status!==next)throw catalog.fault(409,'این درخواست قبلاً با نتیجه دیگری بررسی شده است');
   await conn.commit();committed=true;return res.json({id,status:next,unchanged:true,message:'نتیجه قبلاً ثبت شده است'});
  }
  if(decision==='approve'){
   if(!supplier||supplier.status!=='approved'||!Number(supplier.portal_enabled))throw catalog.fault(409,'حساب فروشنده باید تأییدشده و فعال باشد');
   const [brands]=await conn.execute('SELECT b.id,b.name,b.active FROM supplier_brand_request_items i JOIN brand_catalog b ON b.id=i.brand_id WHERE i.request_id=? ORDER BY b.id FOR SHARE',[id]);
   if(!brands.length||brands.some(row=>!Number(row.active)))throw catalog.fault(409,'یکی از برندهای درخواست غیرفعال شده است؛ درخواست را بررسی کنید');
   const [scopes]=await conn.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand" FOR UPDATE',[supplier.id]);
   const approved=new Set(scopes.map(row=>row.scope_value));
   for(const brand of brands)if(!catalog.resolveAllowedBrand(brand.name,approved))await conn.execute('INSERT INTO supplier_product_scopes (supplier_id,scope_type,scope_value,created_by) VALUES (?,"brand",?,?)',[supplier.id,brand.name,req.user.id]);
   const declared=String(supplier.brands||'').split(/[,،;؛\n\r]+/).map(v=>v.trim()).filter(Boolean),keys=new Set(declared.map(catalog.brandKey));
   for(const brand of brands)if(!keys.has(catalog.brandKey(brand.name))){declared.push(brand.name);keys.add(catalog.brandKey(brand.name));}
   await conn.execute('UPDATE suppliers SET brands=? WHERE id=?',[declared.join('، '),supplier.id]);
  }
  await conn.execute('UPDATE supplier_brand_requests SET status=?,note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',[next,String(req.body.note||'').trim().slice(0,1000)||null,req.user.id,id]);
  await resolveAdminNotification(conn,'supplier_brand_request',id,'/admin/brands#requests');
  await conn.commit();committed=true;notifyAdminNotificationsChanged({entity_type:'supplier_brand_request',entity_id:id,resolved:true});
  res.json({id,status:next,message:decision==='approve'?'برندها به مجوزهای فروشنده اضافه شدند':'درخواست برند رد شد'});
 }catch(error){if(conn&&!committed)await conn.rollback().catch(()=>{});res.status(error.status||500).json({message:error.status?error.message:'بررسی درخواست برند انجام نشد'});}finally{conn?.release();}
});
module.exports=router;
