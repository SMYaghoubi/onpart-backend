const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {
  digits,positiveInteger,paymentDate,last4,destinationChoices,validateDestination
}=require('../lib/manualPayment');
const {resolveUploadStorage}=require('../lib/uploadStorage');

const routeSource=fs.readFileSync(require.resolve('../routes/payments'),'utf8');
const migration=fs.readFileSync(path.join(__dirname,'../migrations/020_track_manual_payment_submitter.sql'),'utf8');
const serverSource=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');

test('manual payment helpers normalize safe integer toman values and ISO dates',()=>{
  assert.equal(digits('۱۲٣۴'),'1234');
  assert.equal(positiveInteger('۷۵۱٬۱۷۰'.replace('٬',',')) ,751170);
  assert.throws(()=>positiveInteger('10.5'),/عدد صحیح مثبت/);
  assert.equal(paymentDate('2026-08-27'),'2026-08-27');
  assert.throws(()=>paymentDate('2026-02-30'),/نامعتبر/);
  assert.equal(last4('۱۲۳۴'),'1234');
});

test('destination account must come from persisted OnPart bank settings',()=>{
  const settings=JSON.stringify([{name:'ملت',owner:'آن پارت',card:'6104-3377-0000-0001'}]);
  assert.deepEqual(destinationChoices(settings),[{
    id:'0',value:'6104-3377-0000-0001',label:'ملت — آن پارت — 6104-3377-0000-0001'
  }]);
  assert.equal(validateDestination('6104-3377-0000-0001',settings),'6104-3377-0000-0001');
  assert.throws(()=>validateDestination('attacker-account',settings),/معتبر نیست/);
});

test('manual receipt route keeps management auth, ownership, debt and masked source constraints',()=>{
  assert.match(routeSource,/router\.post\('\/manual', adminAuth, upload\.single\('file'\)/);
  assert.match(routeSource,/Number\(order\.user_id\)!==userId/);
  assert.match(routeSource,/amount>debt/);
  assert.match(routeSource,/user_bank_cards WHERE id=\? AND user_id=\?/);
  assert.match(routeSource,/\*\*\*\*-\*\*\*\*-\*\*\*\*-\$\{card\.last4\}/);
  assert.match(routeSource,/submitted_by,submission_source,status/);
  assert.match(routeSource,/'management','pending'/);
  assert.match(routeSource,/await conn\.beginTransaction\(\)/);
  assert.match(routeSource,/if\(req\.file&&!committed\)fs\.promises\.unlink/);
});

test('manual payment migration is idempotent and records management submitter',()=>{
  assert.match(migration,/information_schema\.COLUMNS/);
  assert.match(migration,/COLUMN_NAME='submitted_by'/);
  assert.match(migration,/COLUMN_NAME='submission_source'/);
  assert.match(migration,/DEFAULT ''user''/);
  assert.match(migration,/information_schema\.STATISTICS/);
});

test('production upload storage never silently falls back and explicit mount is verified',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'onpart-upload-'));
  try{
    const state=resolveUploadStorage({env:{NODE_ENV:'production',UPLOAD_PATH:temp}});
    assert.equal(state.path,path.resolve(temp));
    assert.equal(state.ready,true);
    assert.equal(state.writable,true);
    assert.equal(state.source,'env');
    assert.equal(state.persistence,'explicit-unverified');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
  assert.throws(()=>resolveUploadStorage({env:{NODE_ENV:'production'},fsApi:{existsSync:()=>false}}),/Persistent upload storage is not configured/);
  assert.throws(()=>resolveUploadStorage({env:{NODE_ENV:'production',UPLOAD_PATH:'relative/uploads'}}),/absolute path/);
});

test('server uses one storage root for static files and reports readiness without path disclosure',()=>{
  assert.match(serverSource,/const uploadStorage=getUploadStorage\(\)/);
  assert.match(serverSource,/express\.static\(uploadPath\)/);
  assert.match(serverSource,/storage:\{status:'ok',writable:uploadStorage\.writable,persistence:uploadStorage\.persistence\}/);
  assert.doesNotMatch(serverSource,/storage:\{[^}]*path:/);
});
