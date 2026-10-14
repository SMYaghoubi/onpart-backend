const router = require('express').Router();
const db     = require('../config/database');
const { auth, adminAuth } = require('../middleware/auth');
const SMS    = require('../config/sms');
const { createNotif } = require('../config/notif');
const multer = require('multer');
const path   = require('path');
const { getUploadStorage } = require('../lib/uploadStorage');
const { createUserNotification } = require('../lib/userNotifications');

const { positiveAmount, reviewCredit } = require('../lib/creditReview');

const uploadPath = getUploadStorage().path;
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => cb(null, `credit_${Date.now()}_${file.fieldname}${path.extname(file.originalname).toLowerCase()}`)
});
const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg','.jpeg','.png','.gif','.webp','.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  allowed.includes(ext) ? cb(null, true) : cb(new Error('فقط تصویر و PDF مجاز است'), false);
};
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });

// ── GET /api/credit ── (admin)
router.get('/', adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT cr.*, u.name as user_name, u.phone as user_phone, u.city as user_city
       FROM credit_requests cr JOIN users u ON cr.user_id=u.id
       ORDER BY cr.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/credit ── (user)
router.post('/', auth, upload.fields([
  { name: 'id_card_file', maxCount: 1 },
  { name: 'guarantee_file', maxCount: 1 },
  { name: 'job_file', maxCount: 1 },
  { name: 'other_file', maxCount: 1 }
]), async (req, res) => {
  try {
    const { amount, guarantee_type, guarantee_detail,
            full_name, mobile, national_code, job,
            province, city, address } = req.body;

    if (!amount || !guarantee_type)
      return res.status(400).json({ message: 'اطلاعات ناقص است' });

    const requestedAmount=positiveAmount(amount);
    if(!['cheque','promissory','guarantor','property'].includes(guarantee_type)) return res.status(400).json({message:'نوع ضمانت معتبر نیست'});
    const id_card_file   = req.files?.id_card_file?.[0]?.filename || null;
    const guarantee_file = req.files?.guarantee_file?.[0]?.filename || null;
    const job_file       = req.files?.job_file?.[0]?.filename || null;
    const other_file     = req.files?.other_file?.[0]?.filename || null;

    const [result] = await db.execute(
      `INSERT INTO credit_requests 
       (user_id,amount,guarantee_type,guarantee_detail,full_name,mobile,national_code,job,province,city,address,id_card_file,guarantee_file,job_file,other_file)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, requestedAmount, guarantee_type, guarantee_detail||'',
       full_name||'', mobile||'', national_code||'', job||'',
       province||'', city||'', address||'',
       id_card_file, guarantee_file, job_file, other_file]
    );

    res.status(201).json({ id: result.insertId, message: 'درخواست اعتبار ثبت شد' });
    await createNotif('credit', 'درخواست اعتبار جدید', `از ${full_name||'کاربر'} به مبلغ ${Number(amount).toLocaleString()} تومان`, '/admin/credit');
  } catch (err) {
    console.error('Credit POST error:', err.message);
    res.status(err.status||500).json({ message: err.status?err.message:'خطای سرور' });
  }
});

// Review is atomic and repeated approval never grants credit twice.
for(const action of ['approve','reject']){
  router.patch('/:id/'+action,adminAuth,async(req,res)=>{
    let result;
    try {
      result=await reviewCredit(db,{id:req.params.id,actorId:req.user.id,action,amount:req.body?.approved_amount,note:req.body?.note});
    } catch(error){return res.status(error.status||500).json({message:error.status?error.message:'خطا در بررسی درخواست اعتبار'});}
    res.json({message:result.changed?(action==='approve'?'اعتبار تأیید و اعطا شد':'درخواست رد شد'):'این درخواست قبلاً بررسی شده است',already_reviewed:!result.changed});
    if(!result.changed)return;
    const request=result.request;
    try {
      const [[user]]=await db.execute('SELECT phone,name FROM users WHERE id=?',[request.user_id]);
      const message=action==='approve'?`درخواست اعتبار شما به مبلغ ${Number(request.approved_amount).toLocaleString()} تومان تأیید شد.`:'درخواست اعتبار شما رد شد.';
      await createUserNotification(request.user_id,action==='approve'?'درخواست اعتبار تأیید شد':'درخواست اعتبار رد شد',message,action==='approve'?'success':'warning','/profile',null,'credit',request.id);
      if(user)await SMS.send(user.phone,message+' آن‌پارت');
    } catch(error){console.error('Credit review notification failed:',error.message);}
  });
}
router.delete('/:id',adminAuth,async(req,res)=>{
  try {
    await reviewCredit(db,{id:req.params.id,actorId:req.user.id,action:'delete'});
    res.json({message:'درخواست حذف شد'});
  } catch(error){res.status(error.status||500).json({message:error.status?error.message:'خطا در حذف درخواست'});}
});
module.exports=router;
