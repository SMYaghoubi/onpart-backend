const ALLOWED_FIELDS=['name','email','role','status','city','address','credit_limit'];
const ROLES=new Set(['user','partner','admin']);
const STATUSES=new Set(['active','inactive','blocked','pending']);

function httpError(status,message){const error=new Error(message);error.status=status;return error}

async function updateManagedUser(db,{actor,userId,payload,hashPassword}){
  const id=Number(userId);
  if(!Number.isSafeInteger(id)||id<=0)throw httpError(400,'شناسه کاربر نامعتبر است');
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [[current]]=await conn.execute('SELECT id,role,status FROM users WHERE id=? FOR UPDATE',[id]);
    if(!current)throw httpError(404,'کاربر یافت نشد');

    const assignments=[],params=[];
    for(const field of ALLOWED_FIELDS){
      if(!Object.prototype.hasOwnProperty.call(payload,field))continue;
      const value=payload[field];
      if(field==='role'&&!ROLES.has(value))throw httpError(400,'نقش کاربر نامعتبر است');
      if(field==='status'&&!STATUSES.has(value))throw httpError(400,'وضعیت کاربر نامعتبر است');
      assignments.push(`${field}=?`);params.push(value===''?null:value);
    }
    const targetRole=Object.prototype.hasOwnProperty.call(payload,'role')?payload.role:current.role;
    const targetStatus=Object.prototype.hasOwnProperty.call(payload,'status')?payload.status:current.status;
    if(actor.role!=='admin'&&(current.role==='admin'||targetRole==='admin'))throw httpError(403,'فقط مدیر کل می‌تواند نقش ادمین را تغییر دهد');

    if(current.role==='admin'&&current.status==='active'&&(targetRole!=='admin'||targetStatus!=='active')){
      const [activeAdmins]=await conn.execute('SELECT id FROM users WHERE role="admin" AND status="active" FOR UPDATE');
      if(activeAdmins.length<=1)throw httpError(409,'آخرین مدیر فعال سیستم قابل تغییر نقش یا غیرفعال‌سازی نیست');
    }

    if(payload.password){if(typeof hashPassword!=='function')throw httpError(500,'Password hashing is not configured');assignments.push('password=?');params.push(await hashPassword(payload.password));}
    if(!assignments.length)throw httpError(400,'تغییری برای ذخیره ارسال نشده است');
    params.push(id);
    await conn.execute(`UPDATE users SET ${assignments.join(',')} WHERE id=?`,params);
    await conn.commit();
    return {id,previousRole:current.role,role:targetRole,status:targetStatus};
  }catch(error){
    try{await conn.rollback()}catch(_){}
    throw error;
  }finally{conn.release()}
}

module.exports={ALLOWED_FIELDS,updateManagedUser};
