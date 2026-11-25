const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const sharp=require('sharp');
const {supplierInventorySchema}=require('./supplierInventory');
const {getUploadStorage}=require('./uploadStorage');
const MAX_IMAGE_BYTES=5*1024*1024;
const MAX_PIXELS=25000000;
const stores=new WeakMap();
const badImage=message=>Object.assign(new Error(message),{status:400});
function imageId(value){
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))throw badImage('شناسهٔ عکس نامعتبر است');
  return value;
}
function privateFilename(id){return 'supplierphoto_'+imageId(id)+'.webp';}
async function prepareImage(buffer,mimetype){
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_IMAGE_BYTES)throw badImage('حجم عکس باید حداکثر ۵ مگابایت باشد');
  const formats={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
  if(!formats[mimetype])throw badImage('عکس باید JPG، PNG یا WebP باشد');
  const signature=buffer.subarray(0,12);
  const magic=mimetype==='image/jpeg'?signature[0]===255&&signature[1]===216&&signature[2]===255
    :mimetype==='image/png'?signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    :signature.toString('ascii',0,4)==='RIFF'&&signature.toString('ascii',8,12)==='WEBP';
  if(!magic)throw badImage('محتوای فایل با نوع عکس مطابقت ندارد');
  try{
    const image=sharp(buffer,{limitInputPixels:MAX_PIXELS,failOn:'warning'});
    const metadata=await image.metadata();
    if(metadata.format!==formats[mimetype]||!metadata.width||!metadata.height||(metadata.pages||1)!==1)throw new Error('invalid format');
    // Decode and re-encode instead of trusting MIME or extension; EXIF/GPS is not copied.
    return await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
  }catch(_){throw badImage('فایل عکس معتبر نیست یا ابعاد آن بیش از حد مجاز است');}
}
function photoStore(db){
  if(stores.has(db))return stores.get(db);
  let readyPromise;
  const ready=()=>{
    if(!readyPromise)readyPromise=(async()=>{
      await supplierInventorySchema(db)();
      const sql=await fs.readFile(path.join(__dirname,'../migrations/022_supplier_product_images.sql'),'utf8');
      await db.query(sql);
    })().catch(e=>{readyPromise=null;throw e;});
    return readyPromise;
  };
  const filePath=filename=>{
    if(!/^supplierphoto_[0-9a-f-]{36}\.webp$/.test(filename))throw new Error('مسیر عکس نامعتبر است');
    return path.join(getUploadStorage().path,'.supplier-product-images',filename);
  };
  async function discard(id,supplierId){
    id=imageId(id);const conn=await db.getConnection();let row;
    try{
      await conn.beginTransaction();
      [[row]]=await conn.execute("SELECT * FROM supplier_product_images WHERE id=? AND supplier_id=? AND state='draft' FOR UPDATE",[id,supplierId]);
      if(!row){await conn.rollback();return false;}
      await conn.execute("DELETE FROM supplier_product_images WHERE id=? AND supplier_id=? AND state='draft'",[id,supplierId]);
      await conn.commit();
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
    await fs.unlink(filePath(row.filename)).catch(()=>{});
    return true;
  }
  async function create(supplierId,buffer,mimetype){
    await ready();
    const [expired]=await db.execute("SELECT id FROM supplier_product_images WHERE supplier_id=? AND state='draft' AND created_at<DATE_SUB(NOW(),INTERVAL 7 DAY)",[supplierId]);
    for(const row of expired)await discard(row.id,supplierId);
    const processed=await prepareImage(buffer,mimetype),id=randomUUID(),filename=privateFilename(id);
    const conn=await db.getConnection();let written=false;
    try{
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM suppliers WHERE id=? FOR UPDATE',[supplierId]);
      const [[count]]=await conn.execute("SELECT COUNT(*) count FROM supplier_product_images WHERE supplier_id=? AND state='draft'",[supplierId]);
      if(Number(count.count)>=100)throw badImage('ابتدا عکس‌های پیش‌نویس را ارسال یا حذف کنید؛ حداکثر ۱۰۰ عکس آمادهٔ ارسال مجاز است');
      await fs.mkdir(path.dirname(filePath(filename)),{recursive:true});
      await fs.writeFile(filePath(filename),processed,{flag:'wx'});written=true;
      await conn.execute('INSERT INTO supplier_product_images (id,supplier_id,filename) VALUES (?,?,?)',[id,supplierId,filename]);
      await conn.commit();return {id};
    }catch(e){await conn.rollback().catch(()=>{});if(written)await fs.unlink(filePath(filename)).catch(()=>{});throw e;}finally{conn.release();}
  }
  async function attach(conn,id,supplierId,batchId,{productId=null,newProductId=null}={}){
    id=imageId(id);if(!id)return;
    const [[row]]=await conn.execute("SELECT id FROM supplier_product_images WHERE id=? AND supplier_id=? AND state='draft' AND created_at>=DATE_SUB(NOW(),INTERVAL 7 DAY) FOR UPDATE",[id,supplierId]);
    if(!row)throw badImage('عکس متعلق به این حساب نیست، قبلاً ارسال شده یا منقضی شده است؛ عکس را دوباره انتخاب کنید');
    await conn.execute("UPDATE supplier_product_images SET state='pending',batch_id=?,product_id=?,new_product_id=? WHERE id=?",[batchId,productId,newProductId,id]);
  }
  async function approve(conn,batch,copied){
    const [rows]=await conn.execute("SELECT im.*,n.product_id resolved_product_id FROM supplier_product_images im LEFT JOIN supplier_new_product_requests n ON n.id=im.new_product_id WHERE im.batch_id=? AND im.supplier_id=? AND im.state='pending' FOR UPDATE",[batch.id,batch.supplier_id]);
    for(const row of rows){
      const productId=row.product_id||row.resolved_product_id;
      if(!productId)throw new Error('عکس به کالای بررسی‌شده متصل نیست');
      const filename='productphoto_'+imageId(row.id)+'.webp',destination=path.join(getUploadStorage().path,filename);
      // A failed process may leave an uncommitted copy; it is still hidden by the public guard.
      await fs.copyFile(filePath(row.filename),destination);copied.push(destination);
      await conn.execute('UPDATE products SET image=? WHERE id=?',['/uploads/'+filename,productId]);
      await conn.execute("UPDATE supplier_product_images SET state='approved',product_id=? WHERE id=?",[productId,row.id]);
    }
  }
  async function read(id,supplierId=null){
    id=imageId(id);if(!id)return null;
    const [[row]]=await db.execute('SELECT * FROM supplier_product_images WHERE id=?'+(supplierId==null?'':' AND supplier_id=?'),supplierId==null?[id]:[id,supplierId]);
    return row?{...row,path:filePath(row.filename)}:null;
  }
  const result={ready,create,attach,approve,read,discard,filePath};
  stores.set(db,result);return result;
}
function approvedPhotoGuard(db){return async(req,res,next)=>{
  let decoded;try{decoded=decodeURIComponent(req.path);}catch(_){return res.sendStatus(404);}
  if(!/productphoto_/i.test(decoded))return next();
  const match=/^\/productphoto_([0-9a-f-]{36})\.webp$/.exec(decoded);
  try{
    const id=match&&imageId(match[1]);if(!id)return res.sendStatus(404);
    const [[photo]]=await db.execute("SELECT im.id FROM supplier_product_images im JOIN products p ON p.id=im.product_id WHERE im.id=? AND im.state='approved' AND p.status='active' AND p.image=?",[id,'/uploads'+decoded]);
    if(!photo)return res.sendStatus(404);next();
  }catch(_){res.sendStatus(404);}
};}
module.exports={MAX_IMAGE_BYTES,MAX_PIXELS,imageId,privateFilename,prepareImage,photoStore,approvedPhotoGuard};

