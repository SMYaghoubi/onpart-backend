const DIGITS=Object.freeze({'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'});
const CODE_SEPARATORS=/[\s\u200c\u200d\u200e\u200f\u2060\-‐‑‒–—―]+/g;
function normalizeProductCode(value){return String(value??'').normalize('NFKC').replace(/[۰-۹٠-٩]/g,digit=>DIGITS[digit]).replace(CODE_SEPARATORS,'').toLowerCase()}
function productCodeSqlExpression(column='p.code'){
  if(!/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/i.test(column))throw new Error('ستون کد نامعتبر است');
  let expression=`LOWER(${column})`;
  const replacements=[['۰','0'],['۱','1'],['۲','2'],['۳','3'],['۴','4'],['۵','5'],['۶','6'],['۷','7'],['۸','8'],['۹','9'],['٠','0'],['١','1'],['٢','2'],['٣','3'],['٤','4'],['٥','5'],['٦','6'],['٧','7'],['٨','8'],['٩','9'],[' ', ''],['\t',''],['\r',''],['\n',''],['‌',''],['‍',''],['-',''],['‐',''],['‑',''],['‒',''],['–',''],['—',''],['―','']];
  for(const [from,to] of replacements)expression=`REPLACE(${expression},'${from}','${to}')`;
  return expression;
}
module.exports={normalizeProductCode,productCodeSqlExpression};