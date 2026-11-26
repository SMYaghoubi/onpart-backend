const router=require('express').Router(),db=require('../config/database');
const {adminAuth}=require('../middleware/auth');
const catalog=require('../lib/brandCatalog');
const ensure=catalog.brandCatalogSchema(db);
const logos=require('../lib/brandLogos');
const owner=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({message:'تغییر فهرست برندها فقط برای مدیر سامانه مجاز است'});
async function ready(_req,res,next){try{await ensure();next();}catch(e){res.status(503).json({message:'فهرست برندها موقتاً در دسترس نیست'})}}
router.get('/registration',ready,async(_req,res)=>{
 try{const [rows]=await db.execute('SELECT id,name,featured,logo_id FROM brand_catalog WHERE active=1 ORDER BY featured DESC,name');res.set('Cache-Control','no-store');res.json({brands:rows.map(catalog.withLogo).map(({logo_id,...row})=>row)});}
 catch(e){res.status(503).json({message:'دریافت برندهای ثبت‌نام انجام نشد'})}
});
router.get('/',adminAuth,ready,async(_req,res)=>{try{const [rows]=await db.execute('SELECT id,name,active,featured,logo_id,created_at FROM brand_catalog ORDER BY featured DESC,name');res.json({brands:rows.map(catalog.withLogo).map(({logo_id,...row})=>row)});}catch(e){res.status(503).json({message:'دریافت برندها انجام نشد'})}});
async function edit(req,res,mode){
 let conn;
 try{
  conn=await db.getConnection();
  const id=Number(req.params.id);if(mode!=='create'&&(!Number.isSafeInteger(id)||id<=0))throw catalog.fault(400,'برند نامعتبر است');
  await conn.beginTransaction();await conn.execute('SELECT id FROM brand_catalog_seed_state WHERE id=1 FOR UPDATE');
  const [all]=await conn.execute('SELECT id,name,active,featured,logo_id FROM brand_catalog FOR UPDATE');
  const current=mode==='create'?null:all.find(row=>row.id===id);
  if(mode!=='create'&&!current)throw catalog.fault(404,'برند یافت نشد');
  if(mode==='delete'){
   if(await catalog.brandUsed(conn,current))throw catalog.fault(409,'این برند در اطلاعات سامانه استفاده شده است؛ برای حفظ سوابق، آن را غیرفعال کنید');
   await conn.execute('DELETE FROM brand_catalog WHERE id=?',[id]);await conn.commit();await logos.removeFile(current.logo_id);return res.json({message:'برند حذف شد'});
  }
  const proposed=req.body.name??current?.name;
  const {name,key}=current&&proposed===current.name?{name:current.name,key:catalog.brandKey(current.name)}:catalog.normalizeBrandName(proposed);if(!current||name!==current.name)catalog.assertDistinct(name,all,current?.id);
  for(const flag of ['active','featured'])if(req.body[flag]!=null&&typeof req.body[flag]!=='boolean')throw catalog.fault(400,'وضعیت برند نامعتبر است');
  const active=req.body.active??(current?Boolean(current.active):true),featured=req.body.featured??(current?Boolean(current.featured):false);
  if(current&&name!==current.name&&await catalog.brandUsed(conn,current))throw catalog.fault(409,'نام این برند در کالا یا مجوزها استفاده شده است؛ برای تغییر فهرست، می‌توانید آن را غیرفعال کنید');
  let saved=id;
  if(current)await conn.execute('UPDATE brand_catalog SET name=?,normalized_key=?,active=?,featured=? WHERE id=?',[name,key,active,featured,id]);
  else{const [row]=await conn.execute('INSERT INTO brand_catalog (name,normalized_key,active,featured,created_by) VALUES (?,?,?,?,?)',[name,key,active,featured,req.user.id]);saved=row.insertId;}
  await conn.commit();res.status(current?200:201).json({id:saved,message:current?'برند ذخیره شد':'برند اضافه شد'});
 }catch(error){if(conn)await conn.rollback().catch(()=>{});res.status(error.status||500).json({message:error.status?error.message:'ذخیره برند انجام نشد'});}finally{conn?.release();}
}
router.post('/',adminAuth,owner,ready,(req,res)=>edit(req,res,'create'));
router.patch('/:id',adminAuth,owner,ready,(req,res)=>edit(req,res,'update'));
router.delete('/:id',adminAuth,owner,ready,(req,res)=>edit(req,res,'delete'));
logos.mount(router,{db,adminAuth,owner,ready});
module.exports=router;
