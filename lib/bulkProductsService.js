const { buildBulkProductUpdate } = require('./productBulkUpdate');

function httpError(status, message) {
  const error = new Error(message);error.status=status;return error;
}
async function bulkUpdateProducts(db, normalized) {
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const {ids,fields}=normalized;
    if(Object.prototype.hasOwnProperty.call(fields,'supplier_id')&&fields.supplier_id!==null){
      const [suppliers]=await conn.execute('SELECT id FROM suppliers WHERE id=? AND status="approved" FOR UPDATE',[fields.supplier_id]);
      if(!suppliers.length)throw httpError(400,'تأمین‌کننده معتبر و تأییدشده نیست');
    }
    const placeholders=ids.map(()=>'?').join(',');
    const [products]=await conn.execute(`SELECT id FROM products WHERE id IN (${placeholders}) FOR UPDATE`,ids);
    if(!products.length)throw httpError(404,'محصولی برای ویرایش پیدا نشد');
    const matchedIds=products.map(product=>Number(product.id)),matchedSet=new Set(matchedIds);
    const updateFields={...fields};
    const availability=Object.prototype.hasOwnProperty.call(updateFields,'available')?updateFields.available:null;
    delete updateFields.available;
    const update=buildBulkProductUpdate(updateFields),matchedPlaceholders=matchedIds.map(()=>'?').join(',');
    const assignments=[...update.assignments],values=[...update.values];
    if(availability!==null) assignments.push(availability?'stock=CASE WHEN stock>0 THEN stock ELSE 1 END':'stock=0');
    const [result]=await conn.execute(`UPDATE products SET ${assignments.join(',')} WHERE id IN (${matchedPlaceholders})`,[...values,...matchedIds]);
    await conn.commit();
    return {requested:ids.length,matched:matchedIds.length,updated:Number(result.affectedRows||0),missing:ids.filter(id=>!matchedSet.has(id)),errors:[]};
  } catch(error) {
    try{await conn.rollback()}catch(_){}
    throw error;
  } finally {conn.release()}
}
module.exports={bulkUpdateProducts};