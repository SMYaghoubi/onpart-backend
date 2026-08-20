const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildDashboard,ACTIVE_SHOP_USERS_SQL}=require('../lib/dashboardService');
const {completeRegistration}=require('../lib/registrationCompletion');
const databaseModule=require.resolve('../config/database');
require.cache[databaseModule]={id:databaseModule,filename:databaseModule,loaded:true,exports:{}};
const {createNotifOnce}=require('../config/notif');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

function dashboardDb(activeUsers,{failActive=false}={}){
  return {execute:async sql=>{
    if(sql===ACTIVE_SHOP_USERS_SQL){if(failActive)throw new Error('users unavailable');return [[{active_users:activeUsers}]];}
    if(sql.includes('total_orders'))return [[{total_orders:2}]];
    if(sql.includes('month_sales'))return [[{month_sales:0}]];
    if(sql.includes('active_partners'))return [[{active_partners:1}]];
    return [[]];
  }};
}

test('dashboard counts all active shop users independently of pagination and filters',async()=>{
  assert.match(ACTIVE_SHOP_USERS_SQL,/COUNT\(\*\)/);
  assert.match(ACTIVE_SHOP_USERS_SQL,/role='user'/);
  assert.match(ACTIVE_SHOP_USERS_SQL,/status='active'/);
  assert.doesNotMatch(ACTIVE_SHOP_USERS_SQL,/LIMIT|OFFSET|search/i);
  const data=await buildDashboard(dashboardDb(4),new Date('2026-08-20T12:00:00Z'));
  assert.equal(data.metrics.active_users,4);
});

test('dashboard exposes unavailable active-user count as null rather than fabricated zero',async()=>{
  const original=console.error;console.error=()=>{};
  try{
    const data=await buildDashboard(dashboardDb(0,{failActive:true}),new Date('2026-08-20T12:00:00Z'));
    assert.equal(data.metrics.active_users,null);
    assert.ok(data.unavailable_sections.includes('active_users'));
  }finally{console.error=original;}
});

function registrationDb(current,{manualApprove='0'}={}){
  const state={begun:0,committed:0,rolledBack:0,released:0,updates:[]};
  const conn={
    beginTransaction:async()=>{state.begun++;},
    commit:async()=>{state.committed++;},
    rollback:async()=>{state.rolledBack++;},
    release:()=>{state.released++;},
    execute:async(sql,params)=>{
      if(sql.startsWith('SELECT id,name,shop_name,password'))return [[current]];
      if(sql.includes('FROM settings'))return [[{value:manualApprove}]];
      if(sql.startsWith('UPDATE users')){state.updates.push({sql,params});return [{affectedRows:1}];}
      throw new Error('unexpected SQL: '+sql);
    }
  };
  return {db:{getConnection:async()=>conn},state};
}

const registrationPayload={name:'کاربر تست',shop_name:'فروشگاه تست',province:'تهران',city:'تهران',address:'آدرس تست',password:'secret1'};

test('registration completion commits account data before reporting a new completion',async()=>{
  const {db,state}=registrationDb({id:7,name:null,shop_name:null,password:null,phone:'09120000000',status:'active'});
  const result=await completeRegistration(db,{userId:7,payload:registrationPayload,hashPassword:async()=> 'hash'});
  assert.equal(result.completedNow,true);
  assert.equal(state.begun,1);assert.equal(state.committed,1);assert.equal(state.rolledBack,0);
  assert.ok(state.updates.some(entry=>entry.sql.includes('password=?')));
});

test('registration retry is idempotent and does not rewrite a completed account',async()=>{
  const {db,state}=registrationDb({id:7,name:'کاربر',shop_name:'فروشگاه',password:'hash',phone:'09120000000',status:'active'});
  const result=await completeRegistration(db,{userId:7,payload:registrationPayload,hashPassword:async()=>{throw new Error('must not hash');}});
  assert.equal(result.completedNow,false);assert.equal(state.committed,1);assert.equal(state.updates.length,0);
});

test('registration management notification is inserted at most once for the same completed user',async()=>{
  let inserted=false,insertCount=0,commits=0;
  const conn={
    beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{},release:()=>{},
    execute:async sql=>{
      if(sql.startsWith('SELECT id FROM notifications'))return [inserted?[{id:1}]:[]];
      if(sql.startsWith('INSERT INTO notifications')){inserted=true;insertCount++;return [{insertId:1}];}
      throw new Error('unexpected SQL: '+sql);
    }
  };
  const database={getConnection:async()=>conn};
  assert.equal(await createNotifOnce('user','کاربر جدید ثبت‌نام کرد','شماره: 0912','/admin/users','user',7,database),true);
  assert.equal(await createNotifOnce('user','کاربر جدید ثبت‌نام کرد','شماره: 0912','/admin/users','user',7,database),false);
  assert.equal(insertCount,1);assert.equal(commits,2);
});
test('OTP request and verification never create the management registration notification',()=>{
  const auth=read('routes/auth.js');
  const otp=auth.slice(auth.indexOf("router.post('/send-otp'"),auth.indexOf("router.post('/login'"));
  assert.doesNotMatch(otp,/createNotif|کاربر جدید ثبت‌نام کرد/);
  const users=read('routes/users.js');
  const completion=users.slice(users.indexOf("router.put('/me'"),users.indexOf("router.get('/', adminAuth"));
  assert.match(completion,/completeRegistration/);
  assert.match(completion,/createNotifOnce\('user','کاربر جدید ثبت‌نام کرد'/);
  assert.ok(completion.indexOf('completeRegistration')<completion.indexOf('createNotifOnce'));
});

test('admin order reads use management auth, default list includes every status and newest orders first',()=>{
  const orders=read('routes/orders.js');
  assert.match(orders,/req\.query\.admin === '1' \? adminAuth/);
  assert.match(orders,/router\.get\('\/', orderReadAuth/);
  assert.match(orders,/router\.get\('\/:id', orderReadAuth/);
  const list=orders.slice(orders.indexOf("router.get('/', orderReadAuth"),orders.indexOf('// ── GET /api/orders/:id'));
  assert.match(list,/if \(status\)/);
  assert.doesNotMatch(list,/status\s*=\s*['"]pending_expert/);
  assert.match(list,/ORDER BY o\.created_at DESC,o\.id DESC/);
});

test('order notifications happen only after commit and rollback is guarded',()=>{
  const orders=read('routes/orders.js');
  const create=orders.slice(orders.indexOf('// ── POST /api/orders ──'),orders.indexOf('// ── PATCH /api/orders/:id/approve'));
  const commit=create.indexOf('await conn.commit()');
  assert.ok(commit>=0);
  assert.ok(create.indexOf("createNotif('order'",commit)>commit);
  assert.ok(create.indexOf("createUserNotification(req.user.id",commit)>commit);
  assert.match(create,/if \(!committed\)[\s\S]*conn\.rollback/);
  assert.match(create,/catch \(sideEffectError\)/);
});