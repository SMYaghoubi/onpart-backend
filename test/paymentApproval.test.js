const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRemainingDebt, approvePayment } = require('../lib/paymentApproval');

function paymentConnection({total=100000,amount=100000,approvedBefore=0,status='pending'}){
  const state={paymentStatus:status,orderStatus:'pending_payment',debt:total,approved:approvedBefore,writes:[]};
  return {state,async execute(sql,params){
    if(sql.startsWith('SELECT * FROM payments'))return [[{id:7,status:state.paymentStatus,amount,user_id:2,order_id:3}]];
    if(sql.startsWith('SELECT id,status,total'))return [[{id:3,status:state.orderStatus,total,debt_remaining:state.debt}]];
    if(sql.startsWith('UPDATE payments SET status="approved"')){state.paymentStatus='approved';state.approved+=amount;state.writes.push('payment');return [{affectedRows:1}]}
    if(sql.includes('SELECT o.id,o.user_id,o.total'))return [[{id:3,user_id:2,total,status:state.orderStatus,approved_amount:state.approved}]];
    if(sql.startsWith('UPDATE orders SET debt_remaining')){state.debt=params[0];state.writes.push('debt');return [{affectedRows:1}]}
    if(sql.startsWith('UPDATE orders SET status=')){state.orderStatus=params[0];state.writes.push('status');return [{affectedRows:1}]}
    if(sql.startsWith('UPDATE orders o'))return [{affectedRows:1}];
    if(sql.includes('SELECT COALESCE(SUM('))return [[{debt:state.debt}]];
    if(sql.startsWith('UPDATE users SET debt'))return [{affectedRows:1}];
    if(sql.startsWith('SELECT * FROM users'))return [[{id:2,name:'کاربر',phone:'0912'}]];
    throw new Error('Unhandled SQL '+sql);
  }};
}

test('full approved payment clears both order and user debt',async()=>{const c=paymentConnection({});const r=await approvePayment(c,7,1);assert.equal(r.remaining,0);assert.equal(r.debt,0);assert.equal(c.state.orderStatus,'preparing')});
test('partial approved payment leaves canonical remainder',async()=>{const c=paymentConnection({amount:35000});const r=await approvePayment(c,7,1);assert.equal(r.remaining,65000);assert.equal(r.debt,65000);assert.equal(c.state.orderStatus,'pending_payment')});
test('approving an approved payment is idempotent', async () => {const c=paymentConnection({status:'approved'});const result=await approvePayment(c,7,1);assert.equal(result.alreadyApproved,true);assert.equal(c.state.writes.length,0)});
test('legacy arithmetic helper never returns negative debt',()=>assert.equal(calculateRemainingDebt(100000,130000),0));