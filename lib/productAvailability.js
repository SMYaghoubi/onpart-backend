const AVAILABLE_LABEL='موجود';
const UNAVAILABLE_LABEL='ناموجود';
const SAFE_AVAILABLE_STOCK=1;

function parseAvailability(value,{allowLegacy=false}={}){
  if(value===true||value===AVAILABLE_LABEL||value==='available')return {available:true,legacy:false};
  if(value===false||value===UNAVAILABLE_LABEL||value==='unavailable')return {available:false,legacy:false};
  if(allowLegacy&&(typeof value==='number'||/^\s*\d+\s*$/.test(String(value||'')))){
    const number=Number(value);
    if(Number.isSafeInteger(number)&&number>=0)return {available:number>0,legacy:true,warning:'ستون موجودی عددی قدیمی به وضعیت موجود/ناموجود تبدیل شد؛ تعداد عددی ذخیره نشد.'};
  }
  const error=new Error('وضعیت موجودی فقط باید «موجود» یا «ناموجود» باشد');
  error.status=400;
  throw error;
}

function stockForAvailability(currentStock,available){
  const current=Math.max(0,Number(currentStock)||0);
  return available?(current>0?current:SAFE_AVAILABLE_STOCK):0;
}

function availabilityLabel(stock){return Number(stock)>0?AVAILABLE_LABEL:UNAVAILABLE_LABEL}

module.exports={AVAILABLE_LABEL,UNAVAILABLE_LABEL,SAFE_AVAILABLE_STOCK,parseAvailability,stockForAvailability,availabilityLabel};
