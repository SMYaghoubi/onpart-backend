const BULK_REMOVE_CHUNK_SIZE=100;
const MAX_BULK_REMOVE_IDS=5000;

function httpError(status,message){const error=new Error(message);error.status=status;return error}
function normalizeProductIds(rawIds,{max=MAX_BULK_REMOVE_IDS}={}){
  if(!Array.isArray(rawIds)||!rawIds.length)throw httpError(400,'حداقل یک محصول را انتخاب کنید');
  if(rawIds.length>max)throw httpError(400,`حداکثر ${max.toLocaleString('fa-IR')} محصول در هر درخواست قابل حذف است`);
  const ids=[];const seen=new Set();
  for(const rawId of rawIds){const id=Number(rawId);if(!Number.isSafeInteger(id)||id<=0)throw httpError(400,'شناسه محصولات نامعتبر است');if(!seen.has(id)){seen.add(id);ids.push(id)}}
  return ids;
}

async function removeProductChunk(db,ids,adminId){
  const conn=await db.getConnection(),placeholders=ids.map(()=>'?').join(',');
  try{
    await conn.beginTransaction();
    const [products]=await conn.execute(`SELECT id,status FROM products WHERE id IN (${placeholders}) FOR UPDATE`,ids);
    const productMap=new Map(products.map(product=>[Number(product.id),product]));
    const foundIds=ids.filter(id=>productMap.has(id));
    const skipped=ids.filter(id=>!productMap.has(id));
    if(!foundIds.length){await conn.commit();return {deleted:[],archived:[],skipped}}
    const foundPlaceholders=foundIds.map(()=>'?').join(',');
    await conn.execute(`DELETE FROM cart_items WHERE product_id IN (${foundPlaceholders})`,foundIds);
    const [historyRows]=await conn.execute(
      `SELECT DISTINCT product_id FROM order_items WHERE product_id IN (${foundPlaceholders})
       UNION SELECT DISTINCT product_id FROM supplier_update_items WHERE product_id IN (${foundPlaceholders})`,
      [...foundIds,...foundIds]
    );
    const historical=new Set(historyRows.map(row=>Number(row.product_id)));
    const deleted=foundIds.filter(id=>productMap.get(id).status!=='inactive'&&!historical.has(id));
    const archived=foundIds.filter(id=>productMap.get(id).status==='inactive'||historical.has(id));
    const newlyArchived=archived.filter(id=>productMap.get(id).status!=='inactive');
    if(deleted.length){const marks=deleted.map(()=>'?').join(',');await conn.execute(`DELETE FROM products WHERE id IN (${marks})`,deleted)}
    if(newlyArchived.length){
      const marks=newlyArchived.map(()=>'?').join(',');
      const [pendingRows]=await conn.execute(`SELECT DISTINCT batch_id FROM supplier_update_items WHERE product_id IN (${marks}) AND status='pending' FOR UPDATE`,newlyArchived);
      await conn.execute(`UPDATE supplier_update_items SET status='rejected',note=COALESCE(note,'محصول توسط مدیریت آرشیو شد') WHERE product_id IN (${marks}) AND status='pending'`,newlyArchived);
      const batchIds=[...new Set(pendingRows.map(row=>Number(row.batch_id)).filter(Number.isSafeInteger))];
      if(batchIds.length){const batchMarks=batchIds.map(()=>'?').join(',');await conn.execute(
        `UPDATE supplier_update_batches b SET b.status='rejected',b.reviewed_by=?,b.reviewed_at=COALESCE(b.reviewed_at,NOW()),b.note=COALESCE(b.note,'درخواست به‌دلیل آرشیو محصول رد شد')
         WHERE b.id IN (${batchMarks}) AND b.status='pending' AND NOT EXISTS(SELECT 1 FROM supplier_update_items i WHERE i.batch_id=b.id AND i.status='pending')`,
        [Number(adminId)||null,...batchIds]
      )}
      await conn.execute(`UPDATE products SET status='inactive',stock=0 WHERE id IN (${marks})`,newlyArchived);
    }
    await conn.commit();
    return {deleted,archived,skipped};
  }catch(error){try{await conn.rollback()}catch(_){}throw error}finally{conn.release()}
}

async function safelyRemoveProducts(db,rawIds,adminId,{chunkSize=BULK_REMOVE_CHUNK_SIZE}={}){
  const ids=normalizeProductIds(rawIds),result={requested:ids.length,deleted:0,archived:0,skipped:0,failed:0,errors:[]};
  for(let offset=0;offset<ids.length;offset+=chunkSize){
    const chunk=ids.slice(offset,offset+chunkSize);
    try{
      const chunkResult=await removeProductChunk(db,chunk,adminId);
      result.deleted+=chunkResult.deleted.length;result.archived+=chunkResult.archived.length;result.skipped+=chunkResult.skipped.length;
    }catch(error){
      result.failed+=chunk.length;
      result.errors.push({from:offset+1,to:offset+chunk.length,count:chunk.length,ids:chunk,message:error.message||'خطای پایگاه داده در این بخش'});
    }
  }
  result.message=`عملیات انجام شد: ${result.deleted.toLocaleString('fa-IR')} حذف کامل، ${result.archived.toLocaleString('fa-IR')} آرشیو، ${result.skipped.toLocaleString('fa-IR')} قبلاً حذف‌شده${result.failed?`، ${result.failed.toLocaleString('fa-IR')} ناموفق؛ دلیل: ${result.errors[0]?.message||'خطای نامشخص'}`:''}`;
  return result;
}

async function safelyRemoveProduct(db,productId,adminId){
  const id=normalizeProductIds([productId])[0];
  const result=await removeProductChunk(db,[id],adminId);
  if(result.skipped.length)throw httpError(404,'محصول یافت نشد');
  return result.deleted.length?{action:'deleted',message:'محصول با موفقیت حذف شد'}:{action:'archived',message:'محصول آرشیو شد؛ سوابق سفارش و مالی آن حفظ شده است'};
}

module.exports={BULK_REMOVE_CHUNK_SIZE,MAX_BULK_REMOVE_IDS,normalizeProductIds,removeProductChunk,safelyRemoveProduct,safelyRemoveProducts};