const test=require('node:test'),assert=require('node:assert/strict');
const {ensureSellerCode,validSellerCode,sellerLabel}=require('../lib/sellerCodes');
function fixture(entries=[]){
 const codes=new Map(entries);
 return {codes,execute:async(sql,params)=>{
  if(sql.startsWith('SELECT seller_code'))return [codes.has(Number(params[0]))?[{seller_code:codes.get(Number(params[0]))}]:[]];
  if(sql.startsWith('INSERT')){if(codes.has(params[0])||[...codes.values()].includes(params[1]))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'});codes.set(params[0],params[1]);return [{affectedRows:1}];}
  throw Error(sql);
 }};
}
test('a seller keeps one stored public code; it is independent of per-product tokens and account IDs',async()=>{
 const db=fixture();assert.equal(await ensureSellerCode(db,12,()=> 'OP-482731'),'OP-482731');assert.equal(await ensureSellerCode(db,12,()=>{throw Error('must reuse existing allocation')}),'OP-482731');assert.equal(sellerLabel('OP-482731'),'فروشنده تأییدشده · کد OP-482731');assert.equal(validSellerCode('OP-000012'),false);
});
test('a generated collision never steals or overwrites another seller code',async()=>{
 const db=fixture([[1,'OP-482731']]),generated=['OP-482731','OP-753824'];assert.equal(await ensureSellerCode(db,2,()=>generated.shift()),'OP-753824');assert.equal(db.codes.get(1),'OP-482731');
});
test('a concurrent allocation for the same account returns its winner',async()=>{
 const db=fixture();let first=true;const execute=db.execute;db.execute=async(sql,p)=>{if(first&&sql.startsWith('INSERT')){first=false;db.codes.set(p[0],'OP-753824');throw Object.assign(Error('concurrent winner'),{code:'ER_DUP_ENTRY'});}return execute(sql,p);};assert.equal(await ensureSellerCode(db,2,()=> 'OP-482731'),'OP-753824');
});
test('invalid generated codes and persistence failures do not invent a label or overwrite records',async()=>{
 await assert.rejects(ensureSellerCode(fixture(),1,()=>'<script>'),/Invalid generated/);
 const db=fixture();db.execute=async sql=>{if(sql.startsWith('SELECT'))return [[]];throw Error('storage unavailable');};await assert.rejects(ensureSellerCode(db,1,()=> 'OP-482731'),/storage unavailable/);assert.equal(sellerLabel('<script>'),'فروشنده تأییدشده');
});
