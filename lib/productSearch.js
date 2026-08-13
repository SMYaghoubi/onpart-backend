const DIGITS=Object.freeze({'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'});
const EMPTY_LABELS=new Set(['','-','—','–']);

function normalizeProductText(value,{compact=false}={}){
  let normalized=String(value??'').normalize('NFKC')
    .replace(/[۰-۹٠-٩]/g,digit=>DIGITS[digit])
    .replace(/[يى]/g,'ی').replace(/ك/g,'ک')
    .replace(/[\u200c\u200d\u200e\u200f\u2060]/g,' ')
    .replace(/[‐‑‒–—―]/g,'-')
    .replace(/\s+/g,' ').trim().toLocaleLowerCase('fa-IR');
  if(compact)normalized=normalized.replace(/[\s-]+/g,'');
  return normalized;
}

function productTextSqlExpression(column){
  if(!/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/i.test(column))throw new Error('ستون جست‌وجو نامعتبر است');
  let expression=`LOWER(COALESCE(${column},''))`;
  const replacements=[
    ['۰','0'],['۱','1'],['۲','2'],['۳','3'],['۴','4'],['۵','5'],['۶','6'],['۷','7'],['۸','8'],['۹','9'],
    ['٠','0'],['١','1'],['٢','2'],['٣','3'],['٤','4'],['٥','5'],['٦','6'],['٧','7'],['٨','8'],['٩','9'],
    ['ي','ی'],['ى','ی'],['ك','ک'],[' ', ''],['\t',''],['\r',''],['\n',''],['‌',''],['‍',''],['-',''],['‐',''],['‑',''],['‒',''],['–',''],['—',''],['―','']
  ];
  for(const [from,to] of replacements)expression=`REPLACE(${expression},'${from}','${to}')`;
  return expression;
}

function mapProductFilterMetadata(rows){
  const result={cars:[],brands:[],categories:[]},seen={car:new Set(),brand:new Set(),category:new Set()};
  const targets={car:'cars',brand:'brands',category:'categories'};
  for(const row of rows||[]){
    const type=String(row.type||''),label=String(row.value??'').replace(/\s+/g,' ').trim();
    if(!targets[type]||EMPTY_LABELS.has(label))continue;
    const key=normalizeProductText(label,{compact:true});
    if(!key||EMPTY_LABELS.has(key)||seen[type].has(key))continue;
    seen[type].add(key);result[targets[type]].push(label);
  }
  const collator=new Intl.Collator('fa',{sensitivity:'base',numeric:true});
  for(const values of Object.values(result))values.sort(collator.compare);
  return result;
}

module.exports={normalizeProductText,productTextSqlExpression,mapProductFilterMetadata};
