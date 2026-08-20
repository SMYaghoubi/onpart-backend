function httpError(status,message){const error=new Error(message);error.status=status;return error}
const clean=value=>String(value??'').trim();

async function completeRegistration(db,{userId,payload,hashPassword}){
  const required={name:'نام و نام خانوادگی',shop_name:'نام فروشگاه',province:'استان',city:'شهر',address:'آدرس'};
  for(const [field,label] of Object.entries(required))if(!clean(payload[field]))throw httpError(400,`${label} الزامی است`);
  if(typeof payload.password!=='string'||payload.password.length<6)throw httpError(400,'رمز عبور باید حداقل ۶ کاراکتر باشد');
  if(typeof hashPassword!=='function')throw httpError(500,'Password hashing is not configured');
  const id=Number(userId);if(!Number.isSafeInteger(id)||id<=0)throw httpError(400,'شناسه کاربر نامعتبر است');
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [[current]]=await conn.execute('SELECT id,name,shop_name,password,phone,status FROM users WHERE id=? FOR UPDATE',[id]);
    if(!current)throw httpError(404,'کاربر یافت نشد');
    const completedBefore=Boolean(current.name&&current.shop_name&&current.password);
    if(completedBefore){await conn.commit();return {id,phone:current.phone,name:current.name,status:current.status,pending:current.status==='pending',completedNow:false}}
    const passwordHash=await hashPassword(payload.password);
    await conn.execute(
      `UPDATE users SET name=?,shop_name=?,province=?,city=?,address=?,national_code=COALESCE(?,national_code),phone_fixed=COALESCE(?,phone_fixed),postal_code=COALESCE(?,postal_code),password=? WHERE id=?`,
      [clean(payload.name),clean(payload.shop_name),clean(payload.province),clean(payload.city),clean(payload.address),clean(payload.national_code)||null,clean(payload.phone_fixed)||null,clean(payload.postal_code)||null,passwordHash,id]
    );
    const [[setting]]=await conn.execute('SELECT value FROM settings WHERE `key`="manual_approve"');
    const pending=setting&&String(setting.value)==='1';
    if(pending)await conn.execute('UPDATE users SET status="pending" WHERE id=?',[id]);
    await conn.commit();
    return {id,phone:current.phone,name:clean(payload.name),status:pending?'pending':current.status,pending,completedNow:true};
  }catch(error){try{await conn.rollback()}catch(_){}throw error}finally{conn.release()}
}

module.exports={completeRegistration};
