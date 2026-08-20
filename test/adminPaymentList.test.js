const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {paymentReadMode,buildPaymentListQuery,mapPaymentRows}=require('../lib/paymentList');
const {buildDashboard}=require('../lib/dashboardService');

const routeSource=fs.readFileSync(require.resolve('../routes/payments'),'utf8');
const fixture=[
  {id:27,user_id:8,order_id:41,amount:'900000',status:'pending',bank:'ملت',receipt_file:'receipt_27.png',allocation_summary:null,src_card:null},
  {id:26,user_id:7,order_id:null,amount:'751170',status:'pending',bank:null,receipt_file:null,allocation_summary:null,src_card:null}
];

test('payment list selects explicit management context without weakening shop auth',()=>{
  assert.equal(paymentReadMode({admin:'1'}),'management');
  assert.equal(paymentReadMode({}),'shop');
  assert.match(routeSource,/paymentReadMode\(req\.query\) === 'management' \? adminAuth/);
  assert.match(routeSource,/router\.get\('\/:id\/receipt', paymentReadAuth/);
});

test('management query keeps pending payments with and without orders or optional metadata',()=>{
  const query=buildPaymentListQuery({mode:'management'});
  assert.match(query.sql,/LEFT JOIN users/);
  assert.match(query.sql,/LEFT JOIN orders/);
  assert.doesNotMatch(query.sql,/WHERE p\.user_id=\?/);
  assert.match(query.sql,/ORDER BY p\.id DESC/);
  assert.deepEqual(query.params,[]);
  const rows=mapPaymentRows(fixture);
  assert.deepEqual(rows.map(row=>row.id),[27,26]);
  assert.equal(rows[1].order_id,null);
  assert.equal(rows[1].bank,null);
  assert.equal(rows[1].has_receipt,false);
  assert.equal(rows[0].has_receipt,true);
});

test('shop list stays isolated and status filter is parameterized and validated',()=>{
  const query=buildPaymentListQuery({mode:'shop',userId:7,status:'pending'});
  assert.match(query.sql,/WHERE p\.user_id=\? AND p\.status=\?/);
  assert.deepEqual(query.params,[7,'pending']);
  assert.throws(()=>buildPaymentListQuery({mode:'management',status:'submitted'}),error=>error.statusCode===400);
});

test('dashboard and admin list use the same pending fixture definition',async()=>{
  const db={execute:async sql=>{
    if(sql.includes("FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.status='pending'"))return [fixture.map(row=>({id:row.id,order_id:row.order_id,amount:row.amount,user_name:'کاربر'}))];
    if(sql.includes('COUNT(*) total_orders'))return [[{total_orders:0}]];
    if(sql.includes('COUNT(*) active_users'))return [[{active_users:0}]];
    if(sql.includes('month_sales'))return [[{month_sales:0}]];
    if(sql.includes('active_partners'))return [[{active_partners:0}]];
    return [[]];
  }};
  const dashboard=await buildDashboard(db,new Date('2026-08-20T12:00:00Z'));
  const list=mapPaymentRows(fixture);
  assert.equal(dashboard.pending_payments.length,list.filter(row=>row.status==='pending').length);
  assert.deepEqual(dashboard.pending_payments.map(row=>row.id),[27,26]);
});