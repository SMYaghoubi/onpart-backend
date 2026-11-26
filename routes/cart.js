const router=require('express').Router(),db=require('../config/database');
const {auth}=require('../middleware/auth');
const {normalizeCartItem,normalizeCartItems}=require('../lib/cartValidation');
const market=require('../lib/marketplace');
const ensure=market.marketplaceSchema(db);
async function ready(_req,res,next){try{await ensure();next();}catch(e){res.status(503).json({message:'سبد خرید موقتاً در دسترس نیست'})}}
router.get('/',auth,ready,async(req,res)=>{
 try{
  const [rows]=await db.execute(`SELECT c.product_id,c.quantity,c.offer_token,c.offer_version,c.quoted_price,codes.seller_code,p.description,p.code,p.car,p.brand,p.image,
   i.final_price current_price,i.offer_version current_version,${market.availableSql} remaining,
   CASE WHEN p.status='active' AND ${market.eligibleSql} THEN 1 ELSE 0 END stock
   FROM cart_items c LEFT JOIN products p ON p.id=c.product_id
   LEFT JOIN supplier_inventory i ON i.offer_token=c.offer_token AND i.product_id=c.product_id
   LEFT JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN supplier_seller_codes codes ON codes.supplier_id=s.id WHERE c.user_id=? ORDER BY c.id`,[req.user.id]);
  res.json(rows.map(r=>({product_id:r.product_id,quantity:r.quantity,description:r.description,code:r.code,car:r.car,brand:r.brand,image:r.image,
   price:r.quoted_price==null?null:Number(r.quoted_price),offer_token:r.offer_token,offer_version:r.offer_version==null?null:Number(r.offer_version),
   seller_code:r.seller_code,offer_label:r.offer_token?market.label(r.seller_code):'پیشنهاد انتخاب نشده',stock:Number(r.stock)>0,
   needs_selection:!r.offer_token,needs_review:!r.offer_token||!Number(r.stock)||Number(r.quoted_price)!==Number(r.current_price)||Number(r.offer_version)!==Number(r.current_version)||Number(r.quantity)>Number(r.remaining)})));
 }catch(e){res.status(503).json({message:'دریافت سبد خرید انجام نشد'})}
});
async function selection(conn,userId,item){
 if(item.offer_token)return item;
 const [[old]]=await conn.execute('SELECT offer_token,offer_version,quoted_price FROM cart_items WHERE user_id=? AND product_id=? FOR UPDATE',[userId,item.product_id]);
 if(!old?.offer_token)throw market.error(409,'ابتدا از صفحه کالا یک پیشنهاد فروشنده انتخاب کنید');
 return {...item,offer_token:old.offer_token,offer_version:Number(old.offer_version),expected_price:Number(old.quoted_price)};
}
async function save(conn,userId,item){
 const chosen=await selection(conn,userId,item);await market.lockOffer(conn,chosen);
 await conn.execute('INSERT INTO cart_items (user_id,product_id,quantity,offer_token,offer_version,quoted_price) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),offer_token=VALUES(offer_token),offer_version=VALUES(offer_version),quoted_price=VALUES(quoted_price)',[userId,item.product_id,item.quantity,chosen.offer_token,chosen.offer_version,chosen.expected_price]);
}
router.patch('/item',auth,ready,async(req,res)=>{
 const normalized=normalizeCartItem(req.body);if(!normalized.valid)return res.status(400).json({message:normalized.message});
 const item=normalized.item,conn=await db.getConnection();
 try{await conn.beginTransaction();if(item.quantity===0)await conn.execute('DELETE FROM cart_items WHERE user_id=? AND product_id=?',[req.user.id,item.product_id]);else await save(conn,req.user.id,item);await conn.commit();res.json({message:'پیشنهاد و تعداد در سبد ثبت شد'});}
 catch(e){await conn.rollback();res.status(e.status||500).json({message:e.status?e.message:'ذخیره سبد خرید انجام نشد'});}finally{conn.release();}
});
router.put('/',auth,ready,async(req,res)=>{
 const normalized=normalizeCartItems(req.body?.items);if(!normalized.valid)return res.status(400).json({message:normalized.message});
 const conn=await db.getConnection();
 try{await conn.beginTransaction();const selected=[];
  for(const item of [...normalized.items].sort((a,b)=>a.product_id-b.product_id)){const chosen=await selection(conn,req.user.id,item);await market.lockOffer(conn,chosen);selected.push(chosen);}
  await conn.execute('DELETE FROM cart_items WHERE user_id=?',[req.user.id]);
  for(const item of selected)await save(conn,req.user.id,item);
  await conn.commit();res.json({message:'سبد خرید به‌روزرسانی شد'});
 }catch(e){await conn.rollback();res.status(e.status||500).json({message:e.status?e.message:'ذخیره سبد خرید انجام نشد'});}finally{conn.release();}
});
router.delete('/', auth,async(req,res)=>{try{await db.execute('DELETE FROM cart_items WHERE user_id=?',[req.user.id]);res.json({ message: 'سبد خرید خالی شد' });}catch(e){res.status(500).json({message:'خطا در حذف سبد خرید'})}});
module.exports=router;
