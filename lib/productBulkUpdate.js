const FIELD_RULES=Object.freeze({
  category:value=>String(value??'').trim().slice(0,100),
  car:value=>String(value??'').trim().slice(0,100),
  brand:value=>String(value??'').trim().slice(0,100),
  price:value=>nonNegativeInteger(value,'قیمت'),
  stock:value=>nonNegativeInteger(value,'موجودی'),
  supplier_id:value=>value===null||value===''?null:positiveInteger(value,'تأمین‌کننده')
});

function positiveInteger(value,label='شناسه'){
  const number=Number(value);if(!Number.isSafeInteger(number)||number<=0)throw new Error(`${label} نامعتبر است`);return number;
}
function nonNegativeInteger(value,label){
  const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw new Error(`${label} نامعتبر است`);return number;
}
function normalizeBulkProductUpdate(ids,fields){
  if(!Array.isArray(ids)||!ids.length)throw new Error('حداقل یک محصول انتخاب کنید');
  const normalizedIds=[...new Set(ids.map(id=>positiveInteger(id,'شناسه محصول')))];
  if(normalizedIds.length>5000)throw new Error('حداکثر ۵۰۰۰ محصول در هر عملیات مجاز است');
  if(!fields||typeof fields!=='object'||Array.isArray(fields))throw new Error('فیلدهای ویرایش نامعتبر است');
  const normalizedFields={};
  for(const [key,value] of Object.entries(fields)){
    if(!FIELD_RULES[key])throw new Error(`فیلد ${key} قابل ویرایش گروهی نیست`);
    normalizedFields[key]=FIELD_RULES[key](value);
  }
  if(!Object.keys(normalizedFields).length)throw new Error('حداقل یک فیلد را فعال کنید');
  return {ids:normalizedIds,fields:normalizedFields};
}
function buildBulkProductUpdate(fields){
  const entries=Object.entries(fields),assignments=entries.map(([key])=>`${key}=?`);
  return {assignments,values:entries.map(([,value])=>value)};
}
module.exports={FIELD_RULES,normalizeBulkProductUpdate,buildBulkProductUpdate};
