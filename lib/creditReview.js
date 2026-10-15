function fail(status,message){throw Object.assign(new Error(message),{status});}
function positiveAmount(value){
  const normalized=String(value??'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬\s]/g,'');
  if(!/^\d+$/.test(normalized))fail(400,'مبلغ اعتبار باید عدد صحیح و مثبت باشد');
  const amount=Number(normalized);
  if(!Number.isSafeInteger(amount)||amount<=0)fail(400,'مبلغ اعتبار معتبر نیست');
  return amount;
}
async function reviewCredit(db,{id,actorId,action,amount,note}){
  if(!['approve','reject','delete'].includes(action))fail(400,'عملیات نامعتبر است');
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[request]]=await conn.execute('SELECT * FROM credit_requests WHERE id=? FOR UPDATE',[id]);
    if(!request)fail(404,'درخواست یافت نشد');
    if(action==='delete'){
      if(request.status==='approved')fail(409,'درخواست اعتبار تأییدشده قابل حذف نیست');
      await conn.execute('DELETE FROM credit_requests WHERE id=?',[id]);
      await conn.commit();return {request,changed:true};
    }
    const status=action==='approve'?'approved':'rejected';
    if(request.status===status){await conn.commit();return {request,changed:false};}
    if(request.status!=='pending')fail(409,'فقط درخواست در انتظار بررسی قابل تغییر است');
    if(action==='approve'){
      const finalAmount=amount===undefined?positiveAmount(request.amount):positiveAmount(amount);
      if(finalAmount>positiveAmount(request.amount))fail(400,'اعتبار تأییدشده نمی‌تواند از مبلغ درخواستی بیشتر باشد');
      await conn.execute('UPDATE credit_requests SET status="approved",approved_amount=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',[finalAmount,actorId,id]);
      await conn.execute('UPDATE users SET credit_limit=COALESCE(credit_limit,0)+? WHERE id=?',[finalAmount,request.user_id]);
      request.approved_amount=finalAmount;
    } else {
      await conn.execute('UPDATE credit_requests SET status="rejected",note=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',[String(note||'').slice(0,1000),actorId,id]);
    }
    await conn.commit();return {request,changed:true};
  } catch(error){try{await conn.rollback();}catch(_){}throw error;}
  finally{conn.release();}
}
module.exports={positiveAmount,reviewCredit};
