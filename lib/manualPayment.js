const {parseBankAccounts}=require('./bankAccountSettings');

function digits(value){
  return String(value??'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
function positiveInteger(value,label='مبلغ'){
  const normalized=digits(value).replace(/[\s,،]/g,'');
  if(!/^\d+$/.test(normalized)||!Number.isSafeInteger(Number(normalized))||Number(normalized)<=0)throw Object.assign(new Error(`${label} باید عدد صحیح مثبت باشد`),{status:400});
  return Number(normalized);
}
function paymentDate(value){
  const normalized=digits(value).trim();
  const match=normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)throw Object.assign(new Error('تاریخ واریز نامعتبر است'),{status:400});
  const date=new Date(`${normalized}T00:00:00Z`);
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==normalized)throw Object.assign(new Error('تاریخ واریز نامعتبر است'),{status:400});
  return normalized;
}
function last4(value){
  const normalized=digits(value).replace(/\D/g,'');
  if(!/^\d{4}$/.test(normalized))throw Object.assign(new Error('فقط چهار رقم آخر کارت مبدأ را وارد کنید'),{status:400});
  return normalized;
}
function destinationChoices(value){
  return parseBankAccounts(value).map((account,index)=>{
    const destination=String(account.card||account.account||account.sheba||'').trim();
    return destination?{id:String(index),value:destination,label:[account.name,account.owner,destination].filter(Boolean).join(' — ')}:null;
  }).filter(Boolean);
}
function validateDestination(value,settingsValue){
  const requested=String(value||'').trim();
  if(!requested||!destinationChoices(settingsValue).some(choice=>choice.value===requested))throw Object.assign(new Error('حساب مقصد انتخاب‌شده معتبر نیست'),{status:400});
  return requested;
}

module.exports={digits,positiveInteger,paymentDate,last4,destinationChoices,validateDestination};
