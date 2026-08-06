const test=require('node:test');
const assert=require('node:assert/strict');
const { allocateApprovedPayment, reconcileOrdersAfterAllocationRemoval }=require('../lib/paymentAllocations');

function allocationConnection({orders,payment,allocations=[]}){
  const state={orders:orders.map(row=>({...row,debt_remaining:row.debt_remaining??row.total})),payment:{...payment},allocations:allocations.map(row=>({...row})),writes:[]};
  return {state,async execute(sql,params=[]){
    if(sql.startsWith('SELECT pa.order_id')){
      const rows=state.allocations.filter(row=>row.payment_id===Number(params[0])).map(row=>{
        const order=state.orders.find(item=>item.id===row.order_id);return {order_id:row.order_id,amount:row.amount,order_status:order.status,debt_remaining:order.debt_remaining};
      });return [rows];
    }
    if(sql.startsWith('SELECT id,status,total,created_at FROM orders')){
      const linked=Number(params.at(-1));const rows=state.orders.filter(row=>row.user_id===state.payment.user_id).sort((a,b)=>(a.id===linked?-1:b.id===linked?1:a.id-b.id));return [rows];
    }
    if(sql.startsWith('SELECT order_id,COALESCE(SUM(amount)')){
      const ids=new Set(params.map(Number)),group=new Map();state.allocations.filter(row=>ids.has(row.order_id)).forEach(row=>group.set(row.order_id,(group.get(row.order_id)||0)+row.amount));return [[...group].map(([order_id,allocated_amount])=>({order_id,allocated_amount}))];
    }
    if(sql.startsWith('INSERT INTO payment_allocations')){state.allocations.push({payment_id:Number(params[0]),order_id:Number(params[1]),amount:Number(params[2])});state.writes.push('allocation');return [{affectedRows:1}]}
    if(sql.startsWith('UPDATE payments SET order_id=')){state.payment.order_id=Number(params[0]);state.writes.push('link');return [{affectedRows:1}]}
    if(sql.includes('SELECT o.id,o.user_id,o.total')){
      const order=state.orders.find(row=>row.id===Number(params[0]));if(!order)return [[]];const approved_amount=state.allocations.filter(row=>row.order_id===order.id).reduce((sum,row)=>sum+row.amount,0);return [[{...order,approved_amount}]];
    }
    if(sql.startsWith('UPDATE orders SET debt_remaining')){const order=state.orders.find(row=>row.id===Number(params[1]));order.debt_remaining=Number(params[0]);state.writes.push('debt');return [{affectedRows:1}]}
    if(sql.startsWith('UPDATE orders SET status=')){const order=state.orders.find(row=>row.id===Number(params.at(-1)));order.status=sql.includes('"preparing"')?'preparing':sql.includes('"pending_payment"')?'pending_payment':params[0];state.writes.push('status');return [{affectedRows:1}]}
    throw new Error('Unhandled SQL '+sql);
  }};
}

test('approved unlinked payment clears matching user debt and gains primary order link',async()=>{
  const payment={id:7,user_id:2,order_id:null,amount:3456915,status:'approved'};
  const c=allocationConnection({payment,orders:[{id:11,user_id:2,total:3456915,status:'pending_payment',created_at:'2026-01-01'}]});
  const result=await allocateApprovedPayment(c,payment);
  assert.deepEqual(result.allocations,[{order_id:11,amount:3456915}]);assert.equal(result.unallocatedAmount,0);assert.equal(c.state.payment.order_id,11);assert.equal(c.state.orders[0].debt_remaining,0);assert.equal(c.state.orders[0].status,'preparing');
});

test('one approved payment allocates FIFO across multiple orders and preserves remainder',async()=>{
  const payment={id:8,user_id:2,order_id:null,amount:200,status:'approved'};
  const c=allocationConnection({payment,orders:[{id:1,user_id:2,total:70,status:'pending_payment'},{id:2,user_id:2,total:100,status:'pending_payment'}]});
  const result=await allocateApprovedPayment(c,payment);
  assert.deepEqual(result.allocations,[{order_id:1,amount:70},{order_id:2,amount:100}]);assert.equal(result.unallocatedAmount,30);assert.deepEqual(c.state.orders.map(row=>row.debt_remaining),[0,0]);
});

test('linked payment is not counted twice and repeated allocation is idempotent',async()=>{
  const payment={id:9,user_id:2,order_id:3,amount:100,status:'approved'};
  const c=allocationConnection({payment,orders:[{id:3,user_id:2,total:100,status:'pending_payment'}]});
  await allocateApprovedPayment(c,payment);const writes=c.state.writes.length;const again=await allocateApprovedPayment(c,payment);
  assert.equal(c.state.allocations.length,1);assert.equal(again.allocatedAmount,100);assert.equal(c.state.writes.length,writes);
});

test('removing approved allocation restores order debt and pending-payment status',async()=>{
  const payment={id:10,user_id:2,order_id:4,amount:80,status:'approved'};
  const c=allocationConnection({payment,orders:[{id:4,user_id:2,total:80,status:'preparing',debt_remaining:0}]});
  c.state.allocations=[];
  const restored=await reconcileOrdersAfterAllocationRemoval(c,[4]);
  assert.deepEqual(restored,[{order_id:4,debt_remaining:80,status:'pending_payment'}]);
});
