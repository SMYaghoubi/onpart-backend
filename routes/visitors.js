const router=require('express').Router();
const rateLimit=require('express-rate-limit');
const db=require('../config/database');
const {auth,adminAuth}=require('../middleware/auth');
const {createVisitorService}=require('../lib/siteVisitors');
const service=createVisitorService(db,{secret:process.env.JWT_SECRET});
const origins=new Set(['https://onpart.ir','https://www.onpart.ir',process.env.FRONTEND_URL].filter(Boolean));
if(process.env.NODE_ENV!=='production'){origins.add('http://localhost:8080');origins.add('http://localhost:3000');}
router.post('/heartbeat',rateLimit({windowMs:60000,max:240,standardHeaders:true,legacyHeaders:false}),
  (req,res,next)=>origins.has(req.get('origin'))?next():res.status(403).json({message:'مبدأ درخواست معتبر نیست'}),
  (req,res,next)=>req.headers.authorization?auth(req,res,next):next(),
  async(req,res)=>{
    try{await service.track(req.body,req.user?.status==='active'?req.user.id:null);res.status(204).end();}
    catch(error){if(!error.status)console.error('Visit tracking failed:',error.message);res.status(error.status||503).json({message:'ثبت بازدید موقتاً در دسترس نیست'});}
  });
router.get('/summary',adminAuth,async(_req,res)=>{
  try{res.json(await service.summary());}
  catch(error){console.error('Visitor summary failed:',error.message);res.status(503).json({message:'آمار بازدید موقتاً در دسترس نیست؛ دوباره تلاش کنید'});}
});
module.exports=router;
