const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRemainingDebt, approvePayment } = require('../lib/paymentApproval');

function paymentConnection({total=100000,amount=100000,status='pending',preallocated=false}){
  const state={payment:{id:7,status,amount,user_id:2,order_id:3},order:{id:3,user_id:2,status:'pending_payment',total,debt_remaining:preallocated?Math.max(0,total-amount):total},allocations:preallocated?[{payment_id:7,order_id:3,amount:Math.min(total,amount)}]:[],writes:[]};
  return {state,async execute(sql,params=[]){
    if(sql.startsWith('SELECT * FROM payments'))return [[state.payment]];
    if(sql.startsWith('SELECT pa.order_id'))return [state.allocations.filter(a=>a.payment_id===7).map(a=>({order_id:3,amount:a.amount,order_status:state.order.status,debt_remaining:state.order.debt_remaining}))];
    if(sql.startsWith('UPDATE payments SET status="approved"')){state.payment.status='approved';state.writes.push('payment');return [{affectedRows:1}]}
    if(sql.startsWith('SELECT id,status,total,created_at FROM orders'))return [[state.order]];
    if(sql.startsWith('SELECT order_id,COALESCE(SUM(amount)'))return [state.allocations.length?[{order_id:3,allocated_amount:state.allocations.reduce((s,a)=>s+a.amount,0)}]:[]];
    if(sql.startsWith('INSERT INTO payment_allocations')){state.allocations.push({payment_id:7,order_id:3,amount:Number(params[2])});state.writes.push('allocation');return [{affectedRows:1}]}
    if(sql.includes('SELECT o.id,o.user_id,o.total')){const approved_amount=state.allocations.reduce((s,a)=>s+a.amount,0);return [[{...state.order,approved_amount}]]}
    if(sql.startsWith('UPDATE orders SET debt_remaining')){state.order.debt_remaining=Number(params[0]);state.writes.push('debt');return [{affectedRows:1}]}
    if(sql.startsWith('UPDATE orders SET status="preparing"')){state.order.status='preparing';state.writes.push('status');return [{affectedRows:1}]}
    if(sql.startsWith('SELECT id,status,total,debt_remaining'))return [[state.order]];
    if(sql.startsWith('UPDATE orders o'))return [{affectedRows:1}];
    if(sql.includes('SELECT COALESCE(SUM('))return [[{debt:state.order.debt_remaining}]];
    if(sql.startsWith('UPDATE users SET debt'))return [{affectedRows:1}];
    if(sql.startsWith('SELECT * FROM users'))return [[{id:2,name:'کاربر',phone:'0912'}]];
    throw new Error('Unhandled SQL '+sql);
  }};
}

test('full approved payment clears both order and user debt',async()=>{const c=paymentConnection({});const r=await approvePayment(c,7,1);assert.equal(r.remaining,0);assert.equal(r.debt,0);assert.equal(c.state.order.status,'preparing')});
test('partial approved payment leaves canonical remainder',async()=>{const c=paymentConnection({amount:35000});const r=await approvePayment(c,7,1);assert.equal(r.remaining,65000);assert.equal(r.debt,65000);assert.equal(c.state.order.status,'pending_payment')});
test('approving an allocated approved payment is idempotent', async () => {const c=paymentConnection({status:'approved',preallocated:true});const result=await approvePayment(c,7,1);assert.equal(result.alreadyApproved,true);assert.equal(result.allocations.length,1);assert.equal(c.state.writes.length,0)});
test('legacy arithmetic helper never returns negative debt',()=>assert.equal(calculateRemainingDebt(100000,130000),0));