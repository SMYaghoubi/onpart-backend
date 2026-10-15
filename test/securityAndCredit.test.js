const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {positiveAmount,reviewCredit}=require('../lib/creditReview');
function load(file,deps){const context={module:{exports:{}},console,process:{env:{}},Buffer,require:key=>{if(Object.hasOwn(deps,key))return deps[key];throw Error('Unexpected dependency '+key)}};vm.runInNewContext(fs.readFileSync(require.resolve(file),'utf8'),context);return context.module.exports;}
function registry(){const routes=[];const router={};for(const method of ['get','post','put','patch','delete'])router[method]=(path,...handlers)=>routes.push({method,path,handlers});return {router,get:(method,path)=>routes.find(r=>r.method===method&&r.path===path)};}
function res(){return {code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};}
test('legacy biometric login cannot issue sessions or expose credential options',async()=>{
 const r=registry();load('../routes/webauthn',{'express':{Router:()=>r.router},'../config/database':{},'../middleware/auth':{auth(){}}});
 for(const path of ['/authenticate','/auth-options','/register']){const response=res();await r.get('post',path).handlers.at(-1)({body:{phone:'09000000000',credentialId:'fixture'}},response);assert.equal(response.code,410);assert.equal(response.body.token,undefined);}
});
test('blocked and pending management accounts cannot use an existing token',async()=>{
 for(const status of ['blocked','pending','inactive','active']){
  const middleware=load('../middleware/auth',{'jsonwebtoken':{verify:()=>({id:1,role:'admin',context:'management'})},'../config/database':{execute:async()=>[[{id:1,role:'admin',status}]]},'../lib/managementAccess':require('../lib/managementAccess')});
  const response=res();let next=false;await middleware.adminAuth({headers:{authorization:'Bearer fixture'}},response,()=>next=true);assert.equal(next,status==='active');if(!next)assert.equal(response.code,403);
 }
});
test('invoice reader scopes customers and selects management authentication explicitly',async()=>{
 const r=registry();let sql,params,mode;load('../routes/invoices',{'express':{Router:()=>r.router},'../config/database':{execute:async(s,p)=>{sql=s;params=p;return [[]]}},'../middleware/auth':{auth:()=>mode='shop',adminAuth:()=>mode='admin'},'../lib/orderDebt':{},'../lib/userNotifications':{}});
 const route=r.get('get','/');for(const admin of [undefined,'1']){const req={query:{admin},user:{id:4}};route.handlers[0](req,res(),()=>{});await route.handlers.at(-1)(req,res());assert.equal(mode,admin?'admin':'shop');if(!admin){assert.match(sql,/AND o.user_id=\?/);assert.deepEqual(Array.from(params),[4]);}else assert.deepEqual(Array.from(params),[]);}
});
function creditFixture(){
 let state={id:7,user_id:2,status:'pending',amount:1000000},credit=0,locked=Promise.resolve();const queries=[];
 const db={getConnection:async()=>{let unlock,snapshot;return {async beginTransaction(){const before=locked;locked=new Promise(r=>unlock=r);await before;snapshot={state:{...state},credit};},async execute(sql,params){queries.push(sql);if(sql.startsWith('SELECT *'))return [[{...state}]];if(sql.startsWith('UPDATE credit_requests')){state.status=sql.includes('"approved"')?'approved':'rejected';state.approved_amount=params[0];}if(sql.startsWith('UPDATE users'))credit+=Number(params[0]);return [{}];},async commit(){},async rollback(){state=snapshot.state;credit=snapshot.credit;},release(){unlock();}}}};
 return {db,queries,get credit(){return credit},get status(){return state.status}};
}
test('concurrent/repeated approval grants credit once and locks the request',async()=>{
 const fixture=creditFixture();const input={id:7,actorId:1,action:'approve',amount:'۵۰۰٬۰۰۰'};
 const results=await Promise.all([reviewCredit(fixture.db,input),reviewCredit(fixture.db,input)]);
 assert.equal(fixture.credit,500000);assert.equal(results.filter(r=>r.changed).length,1);assert.match(fixture.queries[0],/FOR UPDATE/);
 await assert.rejects(reviewCredit(fixture.db,{...input,action:'reject'}),e=>e.status===409);
 await assert.rejects(reviewCredit(fixture.db,{...input,action:'delete'}),e=>e.status===409);assert.equal(fixture.credit,500000);
});
test('approval rejects null, zero, negative, fractional and excessive amounts without changing balances',async()=>{
 for(const amount of [null,0,-1,1.5,'wrong',1000001]){const f=creditFixture();await assert.rejects(reviewCredit(f.db,{id:7,actorId:1,action:'approve',amount}),e=>e.status===400);assert.equal(f.credit,0);assert.equal(f.status,'pending');}
 assert.equal(positiveAmount('۱۲۳٬۴۵۶'),123456);assert.equal(positiveAmount('١٢٣,٤٥٦'),123456);
});
