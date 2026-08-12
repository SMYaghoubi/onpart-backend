function httpError(status,message){const error=new Error(message);error.status=status;return error}

async function safelyRemoveProduct(db,productId,adminId){
  const id=Number(productId);
  if(!Number.isSafeInteger(id)||id<=0)throw httpError(400,'شناسه محصول نامعتبر است');
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [[product]]=await conn.execute('SELECT id,status FROM products WHERE id=? FOR UPDATE',[id]);
    if(!product){await conn.rollback();throw httpError(404,'محصول یافت نشد')}

    await conn.execute('DELETE FROM cart_items WHERE product_id=?',[id]);
    if(product.status==='inactive'){
      await conn.commit();
      return {action:'archived',message:'محصول قبلاً از فهرست فعال حذف شده است'};
    }

    const [[dependencies]]=await conn.execute(
      `SELECT
        EXISTS(SELECT 1 FROM order_items WHERE product_id=? LIMIT 1) has_order_history,
        EXISTS(SELECT 1 FROM supplier_update_items WHERE product_id=? LIMIT 1) has_supplier_history`,
      [id,id]
    );
    const hasHistory=Boolean(Number(dependencies.has_order_history)||Number(dependencies.has_supplier_history));
    if(!hasHistory){
      await conn.execute('DELETE FROM products WHERE id=?',[id]);
      await conn.commit();
      return {action:'deleted',message:'محصول با موفقیت حذف شد'};
    }

    const [pendingRows]=await conn.execute('SELECT DISTINCT batch_id FROM supplier_update_items WHERE product_id=? AND status="pending" FOR UPDATE',[id]);
    await conn.execute(
      `UPDATE supplier_update_items
       SET status='rejected',note=COALESCE(note,'محصول توسط مدیریت آرشیو شد')
       WHERE product_id=? AND status='pending'`,[id]
    );
    if(pendingRows.length){
      const batchIds=pendingRows.map(row=>Number(row.batch_id)).filter(Number.isSafeInteger);
      const placeholders=batchIds.map(()=>'?').join(',');
      await conn.execute(
        `UPDATE supplier_update_batches b
         SET b.status='rejected',b.reviewed_by=?,b.reviewed_at=COALESCE(b.reviewed_at,NOW()),
             b.note=COALESCE(b.note,'درخواست به‌دلیل آرشیو محصول رد شد')
         WHERE b.id IN (${placeholders}) AND b.status='pending'
           AND NOT EXISTS(SELECT 1 FROM supplier_update_items i WHERE i.batch_id=b.id AND i.status='pending')`,
        [Number(adminId)||null,...batchIds]
      );
    }
    await conn.execute('UPDATE products SET status="inactive",stock=0 WHERE id=?',[id]);
    await conn.commit();
    return {action:'archived',message:'محصول آرشیو شد؛ سوابق سفارش و مالی آن حفظ شده است'};
  }catch(error){
    try{await conn.rollback()}catch(_){}
    throw error;
  }finally{conn.release()}
}

module.exports={safelyRemoveProduct};