const path=require('path');

const PAYMENT_STATUSES=Object.freeze(['pending','approved','rejected']);

function paymentReadMode(query={}){
  return query.admin==='1'?'management':'shop';
}

function buildPaymentListQuery({mode='shop',userId,status}={}){
  if(status&&!PAYMENT_STATUSES.includes(status)){
    const error=new Error('وضعیت پرداخت نامعتبر است');
    error.statusCode=400;
    throw error;
  }
  const where=mode==='management'?[]:['p.user_id=?'];
  const params=mode==='management'?[]:[userId];
  if(status){where.push('p.status=?');params.push(status);}
  const whereSql=where.length?'WHERE '+where.join(' AND '):'';
  return {
    sql:`SELECT p.*, u.name as user_name, u.phone as user_phone,
        o.status order_status,o.total order_total,o.debt_remaining,
        COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.payment_id=p.id),0) allocated_amount,
        GREATEST(p.amount-COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.payment_id=p.id),0),0) unallocated_amount,
        (SELECT GROUP_CONCAT(CONCAT(pa.order_id,':',pa.amount) ORDER BY pa.id) FROM payment_allocations pa WHERE pa.payment_id=p.id) allocation_summary,
        CASE p.status WHEN 'pending' THEN 'پرداخت ثبت شده – منتظر تأیید'
          WHEN 'approved' THEN 'پرداخت تأیید شده' WHEN 'rejected' THEN 'پرداخت رد شده' ELSE p.status END status_label
       FROM payments p
       LEFT JOIN users u ON p.user_id=u.id
       LEFT JOIN orders o ON o.id=p.order_id
       ${whereSql} ORDER BY p.id DESC`,
    params
  };
}

function mapPaymentRows(rows=[]){
  return rows.map(source=>{
    const row={...source};
    const digits=String(row.src_card||'').replace(/\D/g,'');
    row.src_card=digits?'****-****-****-'+digits.slice(-4):null;
    row.allocations=String(row.allocation_summary||'').split(',').filter(Boolean).map(value=>{
      const [orderId,amount]=value.split(':');
      return {order_id:Number(orderId),amount:Number(amount)};
    });
    delete row.allocation_summary;
    row.has_receipt=Boolean(row.receipt_file);
    row.receipt_type=row.receipt_file?path.extname(row.receipt_file).slice(1).toLowerCase():null;
    delete row.receipt_file;
    return row;
  });
}

module.exports={PAYMENT_STATUSES,paymentReadMode,buildPaymentListQuery,mapPaymentRows};