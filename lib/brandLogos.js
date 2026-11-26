const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const multer=require('supplier-photo-upload'),rateLimit=require('express-rate-limit');
const {prepareImage}=require('./supplierImages'),{getUploadStorage}=require('./uploadStorage');
const valid=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
const filename=id=>{if(!valid(id))throw Error('Invalid logo id');return path.join(getUploadStorage().path,'.brand-logos',id+'.webp');};
async function removeFile(id){if(valid(id))await fs.unlink(filename(id)).catch(()=>{});}
function mount(router,{db,adminAuth,owner,ready}){
 const limit=rateLimit({windowMs:10*60*1000,max:30,keyGenerator:req=>String(req.user.id),standardHeaders:true,legacyHeaders:false,message:{message:'تعداد بارگذاری زیاد است؛ کمی بعد دوباره تلاش کنید'}});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1,fields:0,parts:1},fileFilter:(_req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))}).single('logo');
 let processing=0;
 function capacity(req,res,next){if(processing>=2)return res.status(429).json({message:'پردازش لوگوها در حال انجام است؛ کمی بعد تلاش کنید'});processing++;let released=false;req.releaseLogo=()=>{if(!released){released=true;processing--;}};res.once('finish',()=>{if(!req.processingLogo)req.releaseLogo();});res.once('close',()=>{if(!req.processingLogo)req.releaseLogo();});next();}
 router.get('/:id/logo',ready,async(req,res)=>{
  try{const [[row]]=await db.execute('SELECT logo_id FROM brand_catalog WHERE id=?',[req.params.id]);if(!row?.logo_id)return res.sendStatus(404);res.set({'Content-Type':'image/webp','Cache-Control':'public, max-age=0, must-revalidate','X-Content-Type-Options':'nosniff'});res.sendFile(filename(row.logo_id),error=>{if(error&&!res.headersSent)res.sendStatus(404);});}catch(error){res.sendStatus(404);}
 });
 router.post('/:id/logo',adminAuth,owner,ready,limit,capacity,(req,res,next)=>upload(req,res,error=>{if(error){req.releaseLogo();return res.status(400).json({message:'یک لوگوی JPG، PNG یا WebP با حجم حداکثر ۲ مگابایت انتخاب کنید'});}next();}),async(req,res)=>{
  req.processingLogo=true;let id,conn,old,written=false,committed=false;
  try{
   if(!req.file)throw Object.assign(Error('یک لوگوی JPG، PNG یا WebP انتخاب کنید'),{status:400});
   const processed=await prepareImage(req.file.buffer,req.file.mimetype);id=randomUUID();
   conn=await db.getConnection();await conn.beginTransaction();const [[brand]]=await conn.execute('SELECT id,logo_id FROM brand_catalog WHERE id=? FOR UPDATE',[req.params.id]);
   if(!brand)throw Object.assign(Error('برند یافت نشد'),{status:404});old=brand.logo_id;
   await fs.mkdir(path.dirname(filename(id)),{recursive:true});await fs.writeFile(filename(id),processed,{flag:'wx'});written=true;
   await conn.execute('UPDATE brand_catalog SET logo_id=? WHERE id=?',[id,brand.id]);await conn.commit();committed=true;await removeFile(old);
   res.status(201).json({logo_url:'/api/brands/'+brand.id+'/logo?v='+id,message:'لوگوی برند ذخیره شد'});
  }catch(error){if(conn&&!committed)await conn.rollback().catch(()=>{});if(written&&!committed)await removeFile(id);res.status(error.status||500).json({message:error.status?error.message:'ذخیره لوگو انجام نشد'});}
  finally{conn?.release();req.releaseLogo();}
 });
 router.delete('/:id/logo',adminAuth,owner,ready,async(req,res)=>{
  let conn,old;try{conn=await db.getConnection();await conn.beginTransaction();const [[brand]]=await conn.execute('SELECT id,logo_id FROM brand_catalog WHERE id=? FOR UPDATE',[req.params.id]);if(!brand){await conn.rollback();return res.status(404).json({message:'برند یافت نشد'});}old=brand.logo_id;await conn.execute('UPDATE brand_catalog SET logo_id=NULL WHERE id=?',[brand.id]);await conn.commit();await removeFile(old);res.json({message:'لوگوی برند حذف شد'});}catch(error){if(conn)await conn.rollback().catch(()=>{});res.status(500).json({message:'حذف لوگو انجام نشد'});}finally{conn?.release();}
 });
}
module.exports={mount,removeFile};
