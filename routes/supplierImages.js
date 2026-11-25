const router=require('express').Router();
const multer=require('supplier-photo-upload');
const rateLimit=require('express-rate-limit');
const db=require('../config/database');
const {supplierAuth,adminAuth}=require('../middleware/auth');
const {resolveAllowedBrand}=require('../lib/supplierBrands');
const {photoStore,MAX_IMAGE_BYTES}=require('../lib/supplierImages');
const store=photoStore(db);
async function ready(req,res,next){try{await store.ready();next();}catch(_){res.status(503).json({message:'بارگذاری عکس موقتاً در دسترس نیست'});}}
const limiter=rateLimit({windowMs:10*60*1000,max:30,keyGenerator:req=>String(req.supplier.id),standardHeaders:true,legacyHeaders:false,message:{message:'تعداد بارگذاری زیاد است؛ چند دقیقه بعد دوباره امتحان کنید'}});
let activeUploads=0;
function capacity(req,res,next){
  if(activeUploads>=2)return res.status(429).json({message:'پردازش عکس‌ها در حال انجام است؛ چند لحظه بعد دوباره امتحان کنید'});
  activeUploads++;let released=false;
  const release=()=>{if(!released){activeUploads--;released=true;}};
  req.releasePhotoSlot=release;req.processingPhoto=false;
  res.once('finish',release);res.once('close',()=>{if(!req.processingPhoto)release();});next();
}
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_IMAGE_BYTES,files:1,fields:1,fieldSize:200,parts:3},fileFilter:(_req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))}).single('image');
router.post('/images',supplierAuth,ready,limiter,capacity,(req,res,next)=>upload(req,res,error=>{
  if(error)return res.status(400).json({message:'یک عکس JPG، PNG یا WebP با حجم حداکثر ۵ مگابایت انتخاب کنید'});
  next();
}),async(req,res)=>{
  req.processingPhoto=true;
  try{
    const [scopes]=await db.execute('SELECT scope_value FROM supplier_product_scopes WHERE supplier_id=? AND scope_type="brand"',[req.supplier.id]);
    if(!resolveAllowedBrand(req.body.brand,new Set(scopes.map(s=>s.scope_value))))return res.status(403).json({message:'برند کالا در دسترسی مجاز شما نیست'});
    if(!req.file)return res.status(400).json({message:'یک عکس JPG، PNG یا WebP انتخاب کنید'});
    res.status(201).json(await store.create(req.supplier.id,req.file.buffer,req.file.mimetype));
  }catch(error){res.status(error.status===400?400:500).json({message:error.status===400?error.message:'ثبت عکس انجام نشد؛ دوباره تلاش کنید'});}
  finally{req.releasePhotoSlot();}
});
function sendPhoto(ownerOnly){return async(req,res)=>{
  try{
    const photo=await store.read(req.params.id,ownerOnly?req.supplier.id:null);
    if(!photo)return res.status(404).json({message:'عکس یافت نشد'});
    res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Type':'image/webp'});
    res.sendFile(photo.path,{dotfiles:'allow'},error=>{if(error&&!res.headersSent)res.status(404).json({message:'عکس یافت نشد'});});
  }catch(_){res.status(404).json({message:'عکس یافت نشد'});}
};}
router.get('/images/:id',supplierAuth,ready,sendPhoto(true));
router.get('/admin/images/:id',adminAuth,ready,sendPhoto(false));
router.delete('/images/:id',supplierAuth,ready,async(req,res)=>{
  try{if(!await store.discard(req.params.id,req.supplier.id))return res.status(409).json({message:'عکس ارسال‌شده قابل حذف نیست یا در دسترسی این حساب نیست'});res.json({message:'عکس پیش‌نویس حذف شد'});}
  catch(_){res.status(400).json({message:'حذف عکس انجام نشد'});}
});
module.exports=router;

