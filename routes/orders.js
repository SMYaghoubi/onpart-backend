const router = require('express').Router();
const db     = require('../config/database');
const SMS    = require('../config/sms');
const { auth, adminAuth } = require('../middleware/auth');
const { normalizeCartItems } = require('../lib/cartValidation');
const { createNotif } = require('../config/notif');
const {
  createUserNotification,
  deleteUserNotificationsForEntity,
  broadcastUserNotificationsChanged,
  broadcastUserDataChanged
} = require('../lib/userNotifications');
const { syncUserDebt } = require('../lib/orderDebt');
const { resolveAdminNotification, notifyAdminNotificationsChanged } = require('../lib/adminNotifications');
const { VALID_STATUSES, validateOrderTransition } = require('../lib/orderWorkflow');
const { orderItemSnapshotSchema, itemSnapshot, insertOrderItem } = require('../lib/orderItemSnapshots');
const ensureOrderSnapshots = orderItemSnapshotSchema(db);
const market=require('../lib/marketplace');
const ensureMarket=market.marketplaceSchema(db);
function buyerItemDTO(item){
  const dto=Object.fromEntries(['id','product_id','code','description','brand','car','car_name','quantity','price','discount','total'].filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]]));
  for(const [field,snapshot] of [['code','snapshot_code'],['description','snapshot_name'],['brand','snapshot_brand'],['car','car_name']])if(item[snapshot]!=null)dto[field]=item[snapshot];
  return dto;
}


function orderReadAuth(req, res, next) {
  return req.query.admin === '1' ? adminAuth(req, res, next) : auth(req, res, next);
}

const supplierPurchasePriceSql = `COALESCE(
  (SELECT inv.supplier_price FROM supplier_inventory inv
   WHERE inv.product_id=p.id AND inv.supplier_id=p.supplier_id),
  (SELECT item.supplier_price FROM supplier_update_items item
   JOIN supplier_update_batches batch ON batch.id=item.batch_id
   WHERE item.product_id=p.id AND batch.supplier_id=p.supplier_id AND item.status='approved'
   ORDER BY item.id DESC LIMIT 1)
)`;

const orderForTransitionSql = `SELECT o.*,u.phone,u.name,
  COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.order_id=o.id AND p.status='approved'),0) approved_amount,
  EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='approved') has_approved_payment,
  (SELECT p.status FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.order_id=o.id ORDER BY p.id DESC LIMIT 1) payment_status
  FROM orders o JOIN users u ON o.user_id=u.id WHERE o.id=? FOR UPDATE`;

const transitionMessages = {
  INVALID_TRANSITION: 'تغییر وضعیت انتخاب‌شده با روند سفارش سازگار نیست',
  INVALID_CURRENT_STATUS: 'وضعیت فعلی سفارش معتبر نیست',
  PAYMENT_REQUIRED: 'تا پیش از تأیید کامل پرداخت، ادامه روند سفارش مجاز نیست'
};

const userStatusNotifications = {
  pending_expert: ['درخواست در انتظار بررسی است', 'درخواست شما برای بررسی کارشناس ثبت شده است.', 'info'],
  pending_customer: ['درخواست شما تأیید شد', 'لطفاً در قسمت سوابق سفارشات، سفارش خود را بررسی و تأیید یا رد کنید.', 'info'],
  pending_payment: ['درخواست توسط شما تأیید شد', 'لطفاً بعد از تکمیل وجه، فیش واریزی خود را از منوی ثبت فیش واریزی تکمیل و ارسال نمایید.', 'info'],
  preparing: ['درخواست شما در حال تأمین است', 'پس از تأمین و جمع‌آوری، سفارش برای شما ارسال می‌شود.', 'success'],
  shipping: ['درخواست شما در حال ارسال است', 'برای رهگیری درخواست، به قسمت سفارشات من بروید و اطلاعات مرسوله و وضعیت ارسال را پیگیری نمایید.', 'success'],
  delivered: ['سفارش تحویل شد', 'سفارش شما با موفقیت تحویل داده شد.', 'success'],
  cancelled: ['سفارش لغو شد', 'وضعیت سفارش شما به لغوشده تغییر کرد.', 'warning']
};

async function notifyOrderStatus(order, status) {
  const message = userStatusNotifications[status];
  if (!order || !message) return;
  await createUserNotification(
    order.user_id,
    message[0],
    `${message[1]} شماره سفارش: ${order.id}`,
    message[2],
    '/orders',
    status,
    'order',
    order.id
  );
}

// ── GET /api/orders ──
// ── GET /api/orders/my ── (user - with items)
router.get('/my', auth, async (req, res) => {
  try {
    const [orders] = await db.execute(
      `SELECT o.*, (SELECT p.status FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.order_id=o.id ORDER BY p.id DESC LIMIT 1) payment_status, (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as items_count
       FROM orders o WHERE o.user_id=? ORDER BY o.id DESC`,
      [req.user.id]
    );

    // Get items for each order
    for(const order of orders){
      const [items] = await db.execute(
        `SELECT oi.*, p.description, p.code, COALESCE(NULLIF(oi.car_name,''),p.car) car FROM order_items oi
         LEFT JOIN products p ON oi.product_id=p.id 
         WHERE oi.order_id=?`,
        [order.id]
      );
      order.items = items.map(buyerItemDTO);
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

router.get('/', orderReadAuth, async (req, res) => {
  try {
    const isAdmin = (req.user.role === 'admin' || req.user.role === 'partner') && req.query.admin === '1';
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = isAdmin ? [] : ['o.user_id=?'];
    const params = isAdmin ? [] : [req.user.id];

    if (status) { where.push('o.status=?'); params.push(status); }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [rows] = await db.execute(
      `SELECT o.*, u.name as user_name, u.phone as user_phone,
       (SELECT p.status FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.order_id=o.id ORDER BY p.id DESC LIMIT 1) payment_status,
       (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as items_count
       FROM orders o LEFT JOIN users u ON o.user_id=u.id
       ${whereStr} ORDER BY o.created_at DESC,o.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/orders/:id ──
router.get('/:id/invoice', adminAuth, async (req, res) => {
  try {
    const [[order]]=await db.execute('SELECT o.*,u.name user_name,u.phone user_phone,u.city user_city,u.address user_address,(SELECT p.status FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.order_id=o.id ORDER BY p.id DESC LIMIT 1) payment_status FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id=?',[req.params.id]);
    if(!order)return res.status(404).json({message:'سفارش یافت نشد'});
    const [items]=await db.execute(`SELECT oi.*,p.code,p.description,COALESCE(NULLIF(oi.car_name,''),p.car) car FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? ORDER BY oi.id`,[order.id]);
    const [settingRows]=await db.execute('SELECT * FROM settings');
    const settings={};settingRows.forEach(row=>settings[row.key]=row.value);
    res.json({order,items,settings});
  }catch(err){res.status(500).json({message:'خطا در دریافت اطلاعات فاکتور'})}
});
router.get('/:id', orderReadAuth, async (req, res) => {
  try {
    const [orders] = await db.execute(
      `SELECT o.*, u.name as user_name, u.phone as user_phone,u.city user_city,u.address user_address,
       (SELECT p.status FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.order_id=o.id ORDER BY p.id DESC LIMIT 1) payment_status
       FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.id=?`,
      [req.params.id]
    );
    if (!orders.length) return res.status(404).json({ message: 'سفارش یافت نشد' });

    if (!['admin','partner'].includes(req.user.role) && Number(orders[0].user_id)!==Number(req.user.id)) return res.status(403).json({ message:'دسترسی غیرمجاز' });
    const [items] = await db.execute(
      `SELECT oi.*, p.description, p.code, p.brand, COALESCE(NULLIF(oi.car_name,''),p.car) car
       FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id
       WHERE oi.order_id=?`,
      [req.params.id]
    );

    res.json({ ...orders[0], items:req.query.admin==='1'?items:items.map(buyerItemDTO) });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/orders/manual ── (admin - manual order)
router.post('/manual', adminAuth, async (req, res) => {
  try { await ensureOrderSnapshots(); await ensureMarket(); }
  catch(error) { return res.status(503).json({message:'ثبت سفارش موقتاً در دسترس نیست؛ دوباره تلاش کنید.'}); }
  const conn=await db.getConnection();
  let committed=false;
  try {
    const { user_name,user_phone,user_city,address,note,user_id }=req.body;
    const normalized=normalizeCartItems((req.body.items||[]).map(item=>({product_id:item.product_id,quantity:item.quantity??item.qty})));
    if(!normalized.valid||!normalized.items.length)return res.status(400).json({message:'برای هر ردیف، یک کالا از فهرست محصولات انتخاب و تعداد معتبر وارد کنید.'});
    const discount=Number(req.body.overall_discount||0);
    if(!Number.isFinite(discount)||discount<0||discount>100)return res.status(400).json({message:'درصد تخفیف نامعتبر است.'});
    const status=req.body.status||'pending_expert';
    if(!VALID_STATUSES.includes(status))return res.status(400).json({message:'وضعیت سفارش نامعتبر است.'});
    await conn.beginTransaction();
    const lines=[];let subtotal=0;
    for(const item of normalized.items){
      const raw=req.body.items.find(row=>Number(row.product_id)===item.product_id);
      const price=Number(raw.price),itemDiscount=Number(raw.discount||0);
      if(!Number.isSafeInteger(price)||price<0||!Number.isFinite(itemDiscount)||itemDiscount<0||itemDiscount>100)throw new Error('قیمت یا تخفیف ردیف نامعتبر است');
      const [[product]]=await conn.execute(`SELECT p.*,${supplierPurchasePriceSql} supplier_cost_price,COALESCE(${supplierPurchasePriceSql},?) cost_price FROM products p WHERE p.id=?`,[price,item.product_id]);
      if(!product)throw new Error('محصول یافت نشد');
      const total=Math.round(item.quantity*price*(1-itemDiscount/100));subtotal+=total;
      if(!Number.isSafeInteger(total)||!Number.isSafeInteger(subtotal))throw new Error('مبلغ سفارش نامعتبر است');
      lines.push({product,quantity:item.quantity,price,discount:itemDiscount,total});
    }
    let finalUserId=user_id;
    if(!finalUserId&&user_phone){
      const [existing]=await conn.execute('SELECT id FROM users WHERE phone=?',[user_phone]);
      if(existing.length){finalUserId=existing[0].id;await conn.execute('UPDATE users SET name=?, city=?, address=? WHERE id=?',[user_name,user_city,address,finalUserId]);}
      else{const [created]=await conn.execute('INSERT INTO users (name,phone,city,address,role,status) VALUES (?,?,?,?,?,?)',[user_name,user_phone,user_city,address,'user','active']);finalUserId=created.insertId;}
    }
    if(!finalUserId){const [created]=await conn.execute('INSERT INTO users (name,phone,role,status) VALUES (?,?,?,?)',[user_name||'مشتری',user_phone||'0000000000','user','active']);finalUserId=created.insertId;}
    const total=Math.round(subtotal*(1-discount/100));
    const [created]=await conn.execute('INSERT INTO orders (user_id,total,status,note,discount_percent) VALUES (?,?,?,?,?)',[finalUserId,total,status,note||'',discount]);
    const orderId=created.insertId;
    for(const line of lines)await insertOrderItem(conn,orderId,line.product.id,line.quantity,line.price,line.discount,line.total,itemSnapshot(line.product));
    await conn.commit();committed=true;
    try{
      const [[user]]=await db.execute('SELECT name,phone FROM users WHERE id=?',[finalUserId]);
      if(user)await SMS.orderConfirmed(user.phone,user.name||'کاربر',orderId);
    }catch(error){console.error('Manual order SMS failed:',error.message);}
    try{await createUserNotification(finalUserId,'سفارش جدید برای شما ثبت شد',`سفارش ${orderId} در پنل ثبت شد.`,'info','/orders','order_submitted','order',orderId);}
    catch(error){console.error('Manual order notification failed:',error.message);}
    res.status(201).json({id:orderId,total,message:'سفارش ثبت شد',user_id:finalUserId});
  }catch(error){
    if(!committed)await conn.rollback();
    console.error('Manual order error:',error.message);
    res.status(400).json({message:error.message||'ثبت سفارش انجام نشد'});
  }finally{conn.release();}
});

// ── POST /api/orders ──
router.post('/', auth, async (req, res) => {
  try { await ensureOrderSnapshots(); await ensureMarket(); }
  catch(error) { return res.status(503).json({message:'ثبت سفارش موقتاً در دسترس نیست؛ دوباره تلاش کنید.'}); }
  const conn = await db.getConnection();
  let committed = false;
  try {
    const normalizedItems=normalizeCartItems(req.body && req.body.items);
    if(!normalizedItems.valid)return res.status(400).json({message:normalizedItems.message});
    const items=normalizedItems.items;
    if (!items.length) return res.status(400).json({ message: 'اقلام سفارش خالی است' });

    await conn.beginTransaction();

    const registered=await market.createOrder(conn,req.user.id,items,req.body.request_key);
    const orderId=registered.id,total=registered.total;
    if(registered.replayed){await conn.commit();committed=true;return res.json({id:orderId,total,message:'این سفارش قبلاً ثبت شده است',replayed:true});}

    await conn.commit();
    committed = true;

    // Post-commit side effects must not turn a saved order into a failed response.
    let user = null;
    try { const [userRows] = await db.execute('SELECT * FROM users WHERE id=?', [req.user.id]); user = userRows[0] || null; }
    catch (sideEffectError) { console.error('Order user lookup failed:', sideEffectError.message); }
    if (user) {
      try { await SMS.orderConfirmed(user.phone, user.name || 'کاربر', orderId); }
      catch (sideEffectError) { console.error('Order confirmation SMS failed:', sideEffectError.message); }
      try { await createNotif('order','سفارش جدید '+orderId,(user.name||user.phone)+' یک سفارش جدید ثبت کرد','/admin/orders','order',orderId); }
      catch (sideEffectError) { console.error('Order admin notification failed:', sideEffectError.message); }
    }
    try { await createUserNotification(req.user.id, 'درخواست شما ثبت شد', `درخواست ${orderId} ثبت شد و منتظر تأیید درخواست باشید.`, 'info', '/orders', 'order_submitted', 'order', orderId); }
    catch (sideEffectError) { console.error('Order user notification failed:', sideEffectError.message); }

    res.status(201).json({ id: orderId, total, message: 'سفارش ثبت شد' });
  } catch (err) {
    if (!committed) {
      try { await conn.rollback(); } catch (_) {}
    }
    res.status(err.status||500).json({ message:err.status?err.message:'ثبت سفارش انجام نشد؛ دوباره تلاش کنید' });
  } finally {
    conn.release();
  }
});

// ── PATCH /api/orders/:id/approve ── (admin) - expert approval with clear confirmation SMS
router.patch('/:id/approve', adminAuth, async (req, res) => {
  const conn=await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.execute('SELECT o.*,u.phone,u.name FROM orders o JOIN users u ON o.user_id=u.id WHERE o.id=? FOR UPDATE', [req.params.id]);
    if (!order) { await conn.rollback(); return res.status(404).json({ message: 'سفارش یافت نشد' }); }
    if (order.status === 'pending_customer') {
      await conn.commit();
      return res.json({ message:'این سفارش قبلاً تأیید شده است', status:'pending_customer', already_approved:true });
    }
    if (order.status !== 'pending_expert') { await conn.rollback(); return res.status(409).json({ message:'سفارش در وضعیت قابل تأیید نیست' }); }
    await conn.execute('UPDATE orders SET status="pending_customer" WHERE id=?', [req.params.id]);
    await resolveAdminNotification(conn,'order',req.params.id,'/admin/orders');
    await conn.commit();
    notifyAdminNotificationsChanged({ entity_type:'order', entity_id:Number(req.params.id), resolved:true });
    try { await SMS.orderApproved(order.phone, order.name || 'کاربر', req.params.id); }
    catch (smsError) { console.error('Expert approval SMS failed:', smsError.message); }
    await notifyOrderStatus(order, 'pending_customer');
    res.json({ message: 'سفارش تایید شد', status: 'pending_customer' });
  } catch (err) {
    try{await conn.rollback()}catch(_){}
    res.status(500).json({ message: 'خطای سرور' });
  } finally { conn.release(); }
});
// ── PATCH /api/orders/:id/deliver ── (admin) - confirm delivery with code
router.patch('/:id/deliver', adminAuth, async (req, res) => {
  const conn=await db.getConnection();
  try {
    const { delivery_code } = req.body;
    if(!delivery_code) return res.status(400).json({ message: 'کد تحویل الزامی است' });
    await conn.beginTransaction();
    const [[order]] = await conn.execute(orderForTransitionSql, [req.params.id]);
    if(!order){ await conn.rollback(); return res.status(404).json({ message:'سفارش یافت نشد' }); }
    const transition=validateOrderTransition(order,'delivered');
    if(!transition.ok){ await conn.rollback(); return res.status(transition.statusCode).json({message:transitionMessages[transition.code]||'تغییر وضعیت مجاز نیست',code:transition.code}); }
    if(transition.unchanged){ await conn.commit(); return res.json({message:'سفارش قبلاً تحویل شده است',status:'delivered',unchanged:true}); }
    if(order.delivery_code && order.delivery_code !== String(delivery_code)){
      await conn.rollback();
      return res.status(400).json({ message: 'کد تحویل اشتباه است' });
    }
    if(order.fulfillment_policy===market.POLICY)await market.assertReceived(conn,order.id);
    await conn.execute('UPDATE orders SET status="delivered" WHERE id=?', [req.params.id]);
    await resolveAdminNotification(conn,'order',req.params.id,'/admin/orders');
    await conn.commit();
    notifyAdminNotificationsChanged({ entity_type:'order', entity_id:Number(req.params.id), resolved:true });
    try { await SMS.orderDelivered(order.phone, order.name||'کاربر', delivery_code); }
    catch(smsError){ console.error('Deliver SMS error:',smsError.message); }
    await notifyOrderStatus(order, 'delivered');
    broadcastUserDataChanged('order','status-changed');
    res.json({ message: 'سفارش تحویل داده شد', status:'delivered' });
  } catch(err) {
    try{await conn.rollback()}catch(_){}
    res.status(500).json({ message: 'خطای سرور' });
  } finally { conn.release(); }
});
// ── PATCH /api/orders/:id/ship ── (admin) - set shipping info and generate delivery code
router.patch('/:id/ship', adminAuth, async (req, res) => {
  const conn=await db.getConnection();
  try {
    const { shipping_method, shipping_tracking, shipping_driver_name, shipping_driver_phone, shipping_vehicle, shipping_plate, shipping_packages } = req.body;
    if (!shipping_method) return res.status(400).json({ message: 'روش ارسال الزامی است' });
    await conn.beginTransaction();
    const [[order]] = await conn.execute(orderForTransitionSql, [req.params.id]);
    if(!order){ await conn.rollback(); return res.status(404).json({message:'سفارش یافت نشد'}); }
    const transition=validateOrderTransition(order,'shipping');
    if(!transition.ok){ await conn.rollback(); return res.status(transition.statusCode).json({message:transitionMessages[transition.code]||'تغییر وضعیت مجاز نیست',code:transition.code}); }
    if(transition.unchanged){ await conn.commit(); return res.json({message:'سفارش قبلاً وارد مرحله ارسال شده است',status:'shipping',delivery_code:order.delivery_code,unchanged:true}); }
    if(order.fulfillment_policy===market.POLICY){await market.assertReceived(conn,order.id);if(shipping_method!=='post')throw market.error(409,'روش این مرحله پست با هزینه ارسال در مقصد است');}
    const needsDeliveryCode = !['post','tipax'].includes(shipping_method);
    const delivery_code = needsDeliveryCode ? Math.floor(100000 + Math.random() * 900000).toString() : null;
    await conn.execute(
      `UPDATE orders SET status='shipping', shipping_method=?, shipping_tracking=?, shipping_driver_name=?, shipping_driver_phone=?, shipping_vehicle=?, shipping_plate=?, shipping_packages=?, delivery_code=? WHERE id=?`,
      [shipping_method, shipping_tracking||'', shipping_driver_name||'', shipping_driver_phone||'', shipping_vehicle||'', shipping_plate||'', shipping_packages||1, delivery_code, req.params.id]
    );
    await resolveAdminNotification(conn,'order',req.params.id,'/admin/orders');
    await conn.commit();
    notifyAdminNotificationsChanged({ entity_type:'order', entity_id:Number(req.params.id), resolved:true });
    try{
      const packagesCount = shipping_packages || 1;
      if(shipping_method === 'post' || shipping_method === 'tipax'){
        await SMS.shippingPost(order.phone, order.name||'کاربر', req.params.id, shipping_tracking||'—', shipping_method);
      } else {
        await SMS.shippingDriver(order.phone, order.name||'کاربر', req.params.id, shipping_driver_name, shipping_driver_phone, shipping_vehicle||shipping_method, shipping_plate, packagesCount, delivery_code);
      }
    } catch(smsErr){ console.error('Ship SMS error:', smsErr.message); }
    await notifyOrderStatus(order, 'shipping');
    broadcastUserDataChanged('order','status-changed');
    res.json({ message: 'اطلاعات ارسال ثبت شد', status:'shipping', delivery_code });
  } catch (err) {
    try{await conn.rollback()}catch(_){}
    console.error('Ship error:', err.message);
    res.status(err.status||500).json({ message:err.status?err.message:'خطای سرور' });
  } finally { conn.release(); }
});
// ── PATCH /api/orders/:id/status ── (admin)
router.patch('/:id/status', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status, clear_shipping } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ message: 'وضعیت نامعتبر' });

    await conn.beginTransaction();
    const [[order]] = await conn.execute(orderForTransitionSql, [req.params.id]);
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ message: 'سفارش یافت نشد' });
    }

    const transition = validateOrderTransition(order, status);
    if (!transition.ok) {
      await conn.rollback();
      return res.status(transition.statusCode).json({ message: transitionMessages[transition.code] || 'تغییر وضعیت مجاز نیست', code: transition.code });
    }
    if (transition.unchanged) {
      await conn.commit();
      return res.json({ message:'وضعیت سفارش تغییری نکرد', status, unchanged:true });
    }
    let debtRemaining = Math.max(0, Number(order.debt_remaining) || 0);
    if (status === 'pending_payment' && order.status !== 'pending_payment' && debtRemaining === 0) {
      debtRemaining = Math.max(0, Number(order.total) || 0);
    } else if (['pending_expert','pending_customer','cancelled'].includes(status)) {
      debtRemaining = 0;
    }

    if(order.fulfillment_policy===market.POLICY && ['shipping','delivered'].includes(status)){if(clear_shipping)throw market.error(409,'اطلاعات ارسال سفارش پستی نباید حذف شود');await market.assertReceived(conn,order.id);if(order.shipping_method!=='post')throw market.error(409,'اطلاعات ارسال پستی را ابتدا از بخش ثبت ارسال تکمیل کنید');}
    if(clear_shipping){
      await conn.execute(
        `UPDATE orders SET status=?,debt_remaining=?,shipping_method=NULL,shipping_tracking=NULL,
         shipping_driver_name=NULL,shipping_driver_phone=NULL,shipping_vehicle=NULL,
         shipping_plate=NULL,shipping_packages=NULL,delivery_code=NULL WHERE id=?`,
        [status, debtRemaining, req.params.id]
      );
    } else {
      await conn.execute('UPDATE orders SET status=?,debt_remaining=? WHERE id=?', [status, debtRemaining, req.params.id]);
    }
    const debt = await syncUserDebt(conn, order.user_id);
    await conn.commit();

    {
      try {
        const name = order.name || 'کاربر';
        const id = req.params.id;
        if (status === 'pending_expert') await SMS.orderConfirmed(order.phone, name, id);
        else if (status === 'pending_customer' || status === 'pending_payment') await SMS.orderApproved(order.phone, name, id);
        else if (status === 'preparing') await SMS.orderPreparing(order.phone, name, id);
        else if (status === 'cancelled') await SMS.orderRejected(order.phone, name, id);
        else if (status === 'delivered') await SMS.orderDelivered(order.phone, name, order.delivery_code || id);
      } catch (smsError) {
        console.error('Order status SMS failed:', smsError.message);
      }
      await notifyOrderStatus(order, status);
      broadcastUserDataChanged('order', 'status-changed');
    }

    res.json({ message: 'وضعیت سفارش و بدهی مشتری به‌روزرسانی شد', status, debt });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    res.status(err.status||500).json({ message:err.status?err.message:'خطای سرور' });
  } finally { conn.release(); }
});

// ── DELETE /api/orders/:id ── (admin) - fully remove order and related data
router.delete('/:id', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.execute(
      `SELECT o.id,o.user_id,o.total,o.debt_remaining,u.name,u.phone FROM orders o
       JOIN users u ON o.user_id=u.id WHERE o.id=? FOR UPDATE`,
      [req.params.id]
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ message: 'سفارش یافت نشد' });
    }
    await conn.execute('DELETE FROM order_items WHERE order_id=?', [req.params.id]);
    await conn.execute('DELETE FROM invoices WHERE order_id=?', [req.params.id]).catch(()=>{});
    await deleteUserNotificationsForEntity(conn, order.user_id, 'order', order.id, '/orders');
    await conn.execute('DELETE FROM orders WHERE id=?', [req.params.id]);
    const debt = await syncUserDebt(conn, order.user_id);
    await conn.commit();
    broadcastUserNotificationsChanged();
    try { await SMS.orderRejected(order.phone, order.name || 'کاربر', order.id); }
    catch (smsError) { console.error('Delete order SMS failed:', smsError.message); }
    await createUserNotification(
      order.user_id, 'سفارش حذف شد', `سفارش ${order.id} توسط مدیریت حذف شد.`,
      'warning', '/orders', 'cancelled', null, null
    );
    res.json({ message: 'سفارش حذف شد و بدهی مشتری اصلاح شد', debt });
  } catch (err) {
    await conn.rollback();
    console.error('Delete order error:', err.message);
    res.status(500).json({ message: 'خطا در حذف سفارش' });
  } finally {
    conn.release();
  }
});

// ── PUT /api/orders/:id/items ── (admin) - replace order items, recalc total
router.put('/:id/items', adminAuth, async (req, res) => {
  try { await ensureOrderSnapshots(); await ensureMarket(); }
  catch(error) { return res.status(503).json({message:'ویرایش سفارش موقتاً در دسترس نیست؛ دوباره تلاش کنید.'}); }
  const conn = await db.getConnection();
  try {
    const { items, overall_discount } = req.body; // [{product_id, quantity, price, discount}]
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: 'حداقل یک قلم الزامی است' });
    const normalized=normalizeCartItems(items);
    if (!normalized.valid || normalized.items.length!==items.length || items.some(item=>!Number.isSafeInteger(Number(item.price)) || Number(item.price)<0 || !Number.isFinite(Number(item.discount||0)) || Number(item.discount||0)<0 || Number(item.discount||0)>100))
      return res.status(400).json({message:'قیمت، تعداد یا تخفیف ردیف نامعتبر است'});
    if (!Number.isFinite(Number(overall_discount||0)) || Number(overall_discount||0)<0 || Number(overall_discount||0)>100)
      return res.status(400).json({message:'درصد تخفیف نامعتبر است'});

    await conn.beginTransaction();
    const [[order]] = await conn.execute(
      'SELECT id,user_id,status,fulfillment_policy FROM orders WHERE id=? FOR UPDATE',
      [req.params.id]
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ message:'سفارش یافت نشد' });
    }

    if(order.fulfillment_policy===market.POLICY){await conn.rollback();return res.status(409).json({message:'اقلام پیشنهاد انتخاب‌شده ثابت است؛ برای اصلاح، سفارش را لغو و سفارش جدید ثبت کنید.'});}
    if (!['pending_expert', 'pending_customer'].includes(order.status)) {
      await conn.rollback();
      return res.status(409).json({ message: 'اقلام فاکتور پس از تأیید مشتری قابل ویرایش نیستند' });
    }

    const [previousItems] = await conn.execute('SELECT * FROM order_items WHERE order_id=? ORDER BY id', [req.params.id]);
    const previousByProduct = new Map(previousItems.map(item=>[Number(item.product_id),item]));
    await conn.execute('DELETE FROM order_items WHERE order_id=?', [req.params.id]);

    let subtotal = 0;
    for (const item of items) {
      const itemDiscount = Number(item.discount) || 0;
      const lineTotal = Math.round(item.quantity * item.price * (1 - itemDiscount / 100));
      subtotal += lineTotal;
      if (!Number.isSafeInteger(subtotal)) throw new Error('مبلغ سفارش نامعتبر است');
      const [[costRow]]=await conn.execute(`SELECT p.*,${supplierPurchasePriceSql} supplier_cost_price,COALESCE(${supplierPurchasePriceSql},?) cost_price FROM products p WHERE p.id=?`,[item.price,item.product_id]);
      if (!costRow) throw new Error('محصول یافت نشد');
      await insertOrderItem(conn,req.params.id,item.product_id,item.quantity,item.price,itemDiscount,lineTotal,
        itemSnapshot(costRow,previousByProduct.get(Number(item.product_id))));
    }

    const overallDiscount = Number(overall_discount) || 0;
    const finalTotal = Math.round(subtotal * (1 - overallDiscount / 100));

    await conn.execute('UPDATE orders SET total=?, discount_percent=? WHERE id=?', [finalTotal, overallDiscount, req.params.id]);
    const debt=await syncUserDebt(conn,order.user_id);
    await conn.commit();

    broadcastUserDataChanged('order','draft-updated');
    // Editing/saving invoice data is intentionally silent. Customer SMS and
    // notifications are emitted only by real workflow status transitions.
    res.json({ message: 'پیش‌نویس فاکتور ذخیره شد', total: finalTotal, debt });
  } catch (err) {
    await conn.rollback();
    console.error('Update order items error:', err.message);
    res.status(500).json({ message: 'خطا در ذخیره فاکتور', detail: err.message });
  } finally {
    conn.release();
  }
});

// ── PATCH /api/orders/:id/customer-approve ── (customer confirms invoice)
router.patch('/:id/customer-approve', auth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.execute(
      'SELECT * FROM orders WHERE id=? AND user_id=? FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ message: 'سفارش یافت نشد' });
    }
    if (order.status !== 'pending_customer') {
      await conn.rollback();
      return res.status(400).json({ message: 'این سفارش در وضعیت قابل تایید نیست' });
    }

    await conn.execute(
      'UPDATE orders SET status="pending_payment",debt_remaining=total WHERE id=?',
      [req.params.id]
    );

    const [[user]] = await conn.execute('SELECT role FROM users WHERE id=?', [order.user_id]);
    if(user && user.role === 'user'){
      await syncUserDebt(conn, order.user_id);
    }
    await conn.commit();
    await notifyOrderStatus(order, 'pending_payment');

    res.json({ message: 'فاکتور تایید شد', status: 'pending_payment' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    res.status(500).json({ message: 'خطای سرور' });
  } finally { conn.release(); }
});

// ── PATCH /api/orders/:id/customer-reject ── (customer rejects invoice)
router.patch('/:id/customer-reject', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const [[order]] = await db.execute('SELECT * FROM orders WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!order) return res.status(404).json({ message: 'سفارش یافت نشد' });
    if (order.status !== 'pending_customer') return res.status(400).json({ message: 'این سفارش در وضعیت قابل رد نیست' });

    await db.execute('UPDATE orders SET status="cancelled" WHERE id=?', [req.params.id]);
    await resolveAdminNotification(db,'order',req.params.id,'/admin/orders');
    notifyAdminNotificationsChanged({ entity_type:'order', entity_id:Number(req.params.id), resolved:true });
    await notifyOrderStatus(order, 'cancelled');

    res.json({ message: 'فاکتور رد شد', status: 'cancelled' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;


