const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {updateManagedUser}=require('../lib/managedUserUpdate');

function mockDb({current={id:7,role:'partner',status:'active'},activeAdmins=[{id:1},{id:2}]}={}){
  const calls=[];
  const conn={
    beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),
    execute:async(sql,params=[])=>{calls.push({sql,params});if(sql.startsWith('SELECT id,role,status'))return [[current]];if(sql.startsWith('SELECT id FROM users WHERE role='))return [activeAdmins];if(sql.startsWith('UPDATE users SET'))return [{affectedRows:1}];throw new Error('Unexpected SQL: '+sql)}
  };
  return {db:{getConnection:async()=>conn},calls};
}

test('admin can downgrade partner to user without touching password or related data',async()=>{
  const {db,calls}=mockDb();const result=await updateManagedUser(db,{actor:{id:1,role:'admin'},userId:7,payload:{role:'user',phone:'0912',password:undefined}});
  assert.equal(result.role,'user');const update=calls.find(call=>call.sql&&call.sql.startsWith('UPDATE users SET'));
  assert.equal(update.sql,'UPDATE users SET role=? WHERE id=?');assert.deepEqual(update.params,['user',7]);
  assert.doesNotMatch(update.sql,/password|phone|bank|card|order|supplier/);
  assert.ok(calls.includes('commit'));assert.ok(!calls.includes('rollback'));
});

test('admin can downgrade another active admin when another active admin remains',async()=>{
  const {db,calls}=mockDb({current:{id:2,role:'admin',status:'active'},activeAdmins:[{id:1},{id:2}]});
  const result=await updateManagedUser(db,{actor:{id:1,role:'admin'},userId:2,payload:{role:'user'}});
  assert.equal(result.role,'user');assert.ok(calls.includes('commit'));
});

test('last active admin downgrade is rejected transactionally with a clear conflict',async()=>{
  const {db,calls}=mockDb({current:{id:1,role:'admin',status:'active'},activeAdmins:[{id:1}]});
  await assert.rejects(()=>updateManagedUser(db,{actor:{id:1,role:'admin'},userId:1,payload:{role:'user'}}),error=>error.status===409&&/آخرین مدیر فعال/.test(error.message));
  assert.ok(calls.includes('rollback'));assert.ok(!calls.includes('commit'));
});

test('partner cannot promote or downgrade an admin',async()=>{
  const targetAdmin=mockDb({current:{id:1,role:'admin',status:'active'}});
  await assert.rejects(()=>updateManagedUser(targetAdmin.db,{actor:{id:3,role:'partner'},userId:1,payload:{role:'user'}}),error=>error.status===403);
  const targetUser=mockDb({current:{id:4,role:'user',status:'active'}});
  await assert.rejects(()=>updateManagedUser(targetUser.db,{actor:{id:3,role:'partner'},userId:4,payload:{role:'admin'}}),error=>error.status===403);
});

test('route invalidates the changed user so a stale management token is fresh-checked',()=>{
  const users=fs.readFileSync(path.join(__dirname,'..','routes/users.js'),'utf8');
  const auth=fs.readFileSync(path.join(__dirname,'..','middleware/auth.js'),'utf8');
  assert.match(users,/updateManagedUser\([\s\S]*invalidateUserCache\(result\.id\)/);
  assert.match(auth,/adminAuth[\s\S]*getUser\(decoded\.id, \{ fresh: true \}\)/);
  assert.match(auth,/const user = await getUser\(decoded\.id\)/);
  assert.match(auth,/managementStoredRoleStatus\(user\.role\) !== 200/);
});
