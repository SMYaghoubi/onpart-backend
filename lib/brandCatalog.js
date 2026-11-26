const fs = require('node:fs');
const path = require('node:path');
const { normalizeBrand, brandKey, resolveAllowedBrand } = require('./supplierBrands');
const initializers = new WeakMap();
const fault = (status,message) => Object.assign(new Error(message),{status});
const aliases = name => new Set([name,...String(name).split('|')].map(value=>brandKey(value).replace(/\s/g,'')).filter(Boolean));
function normalizeBrandName(value){
  if(typeof value!=='string'||/[\r\n,،;؛]/.test(value))throw fault(400,'نام برند را وارد کنید');
  const name=normalizeBrand(value).replace(/[\u0000-\u001f\u007f]/g,'').trim(),key=brandKey(name);
  if(!name||name.length>150||key.length>190||/[\r\n,،;؛]/.test(name))throw fault(400,'نام برند باید یک نام معتبر، حداکثر ۱۵۰ حرف و بدون جداکننده لیست باشد');
  return {name,key};
}
function assertDistinct(name,rows,exceptId=null){
 const incoming=aliases(name);
 const same=rows.find(row=>Number(row.id)!==Number(exceptId)&&[...aliases(row.name)].some(key=>incoming.has(key)));
 if(same)throw fault(409,'این برند یا نام معادل آن قبلاً با عنوان «'+same.name+'» ثبت شده است');
}
function brandCatalogSchema(db){
 if(initializers.has(db))return initializers.get(db);let ready,status='pending';
 const ensure=()=>ready||=(async()=>{
  const conn=await db.getConnection();let locked=false,transaction=false;
  try{
   const [[lock]]=await conn.query("SELECT GET_LOCK(CONCAT('onpart:brands:',LEFT(SHA2(DATABASE(),256),40)),10) acquired");
   if(!Number(lock.acquired))throw Error('Brand catalog initialization busy');locked=true;
   const sql=fs.readFileSync(path.join(__dirname,'../migrations/026_managed_brand_catalog.sql'),'utf8').split(';').map(v=>v.trim()).filter(Boolean);
   for(const statement of sql)await conn.query(statement);
   await conn.beginTransaction();transaction=true;
   const [[seed]]=await conn.execute('SELECT seeded FROM brand_catalog_seed_state WHERE id=1 FOR UPDATE');
   if(!Number(seed.seeded)){
    // Import reviewed legacy master data once. Later product edits never create brands implicitly.
    const [legacy]=await conn.execute("SELECT DISTINCT TRIM(brand) name FROM products WHERE status='active' AND brand IS NOT NULL AND TRIM(brand)<>'' UNION SELECT DISTINCT TRIM(scope_value) name FROM supplier_product_scopes WHERE scope_type='brand' AND TRIM(scope_value)<>''");
    for(const row of legacy){const name=normalizeBrand(row.name),key=brandKey(name);await conn.execute('INSERT IGNORE INTO brand_catalog (name,normalized_key) VALUES (?,?)',[name,key]);}
    await conn.execute('UPDATE brand_catalog_seed_state SET seeded=1 WHERE id=1');
   }
   await conn.commit();transaction=false;status='ok';
  }catch(error){if(transaction)await conn.rollback();throw error;}
  finally{try{if(locked)await conn.query("SELECT RELEASE_LOCK(CONCAT('onpart:brands:',LEFT(SHA2(DATABASE(),256),40)))");}finally{conn.release();}}
 })().catch(error=>{ready=undefined;status='unavailable';throw error;});
 ensure.status=()=>status;initializers.set(db,ensure);return ensure;
}
async function brandsByIds(conn,raw,lock=false){
 if(!Array.isArray(raw)||!raw.length||raw.length>200)throw fault(400,'بین ۱ تا ۲۰۰ برند از فهرست انتخاب کنید');
 if(raw.some(value=>!(typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value))))throw fault(400,'شناسه برند نامعتبر است');
 const ids=[...new Set(raw.map(Number))].sort((a,b)=>a-b);
 if(ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw fault(400,'شناسه برند نامعتبر است');
 const [rows]=await conn.execute('SELECT id,name,active,featured,logo_id FROM brand_catalog WHERE id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id'+(lock?' FOR SHARE':''),ids);
 if(rows.length!==ids.length||rows.some(row=>!Number(row.active)))throw fault(409,'یکی از برندهای انتخابی در فهرست فعال مدیریت نیست؛ فهرست را تازه‌سازی کنید');
 return rows;
}
async function assertActiveNames(conn,names){
 const [rows]=await conn.execute('SELECT id,name FROM brand_catalog WHERE active=1');
 const mapped=names.map(name=>{
  const match=rows.find(row=>brandKey(row.name)===brandKey(name));
  if(!match)throw fault(400,'برند «'+name+'» در فهرست فعال مدیریت نیست');return match.name;
 });return [...new Set(mapped)];
}
async function brandUsed(conn,brand){
 const [[row]]=await conn.execute("SELECT EXISTS(SELECT 1 FROM supplier_brand_request_items WHERE brand_id=?) used",[brand.id]);
 if(Number(row.used))return true;
 const [labels]=await conn.execute("SELECT DISTINCT brand name FROM products WHERE brand IS NOT NULL UNION SELECT DISTINCT scope_value name FROM supplier_product_scopes WHERE scope_type='brand'");
 const key=brandKey(brand.name);
 if(labels.some(row=>brandKey(row.name)===key))return true;
 const [applications]=await conn.execute("SELECT brands FROM suppliers WHERE brands IS NOT NULL AND brands<>''");
 const keys=aliases(brand.name);
 return applications.some(row=>String(row.brands).split(/[,،;؛\n\r]+/).some(name=>[...aliases(name)].some(alias=>keys.has(alias))));
}
const withLogo=row=>({...row,logo_url:row.logo_id?'/api/brands/'+row.id+'/logo?v='+row.logo_id:null});
module.exports={withLogo,brandCatalogSchema,normalizeBrandName,assertDistinct,brandsByIds,assertActiveNames,brandUsed,fault,brandKey,resolveAllowedBrand};
