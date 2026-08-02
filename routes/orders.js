const router = require('express').Router();
const db     = require('../config/database');
const SMS    = require('../config/sms');
const { auth, adminAuth } = require('../middleware/auth');
const { createNotif } = require('../config/notif');
const { createUserNotification } = require('../lib/userNotifications');

const userStatusNotifications = {
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
  await createUserNotification(order.user_id, message[0], `${message[1]} شماره سفارش: #${order.id}`, message[2], '/orders.html', status);
}

// ── GET /api/orders ──
// ── GET /api/orders/my ── (user - with items)
router.get('/my', auth, async (req, res) => {
  try {
    const [orders] = await db.execute(
      `SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as items_count
       FROM orders o WHERE o.user_id=? ORDER BY o.id DESC`,
      [req.user.id]
    );

    // Get items for each order
    for(const order of orders){
      const [items] = await db.execute(
        `SELECT oi.*, p.description, p.code FROM order_items oi 
         LEFT JOIN products p ON oi.product_id=p.id 
         WHERE oi.order_id=?`,
        [order.id]
      );
      order.items = items;
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

router.get('/', auth, async (req, res) => {
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
       (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as items_count
       FROM orders o LEFT JOIN users u ON o.user_id=u.id
       ${whereStr} ORDER BY o.id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── GET /api/orders/:id ──
router.get('/:id', auth, async (req, res) => {
  try {
    const [orders] = await db.execute(
      `SELECT o.*, u.name as user_name, u.phone as user_phone
       FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.id=?`,
      [req.params.id]
    );
    if (!orders.length) return res.status(404).json({ message: 'سفارش یافت نشد' });

    const [items] = await db.execute(
      `SELECT oi.*, p.description, p.code, p.brand
       FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id
       WHERE oi.order_id=?`,
      [req.params.id]
    );

    res.json({ ...orders[0], items });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── POST /api/orders/manual ── (admin - manual order)
router.post('/manual', adminAuth, async (req, res) => {
  try {
    const { user_name, user_phone, user_city, address, items, total, status, note, user_id } = req.body;

    // Find or create user
    let finalUserId = user_id;
    if (!finalUserId && user_phone) {
      const [existing] = await db.execute('SELECT id FROM users WHERE phone=?', [user_phone]);
      if (existing.length) {
        finalUserId = existing[0].id;
        await db.execute('UPDATE users SET name=?, city=?, address=? WHERE id=?', [user_name, user_city, address, finalUserId]);
      } else {
        const [result] = await db.execute(
          'INSERT INTO users (name, phone, city, address, role, status) VALUES (?,?,?,?,?,?)',
          [user_name, user_phone, user_city, address, 'user', 'active']
        );
        finalUserId = result.insertId;
      }
    }

    if (!finalUserId) {
      // Create anonymous user
      const [result] = await db.execute(
        'INSERT INTO users (name, phone, role, status) VALUES (?,?,?,?)',
        [user_name || 'مشتری', user_phone || '0000000000', 'user', 'active']
      );
      finalUserId = result.insertId;
    }

    const [orderResult] = await db.execute(
      'INSERT INTO orders (user_id, total, status, note) VALUES (?,?,?,?)',
      [finalUserId, total || 0, status || 'pending_expert', note || '']
    );
    const orderId = orderResult.insertId;

    res.status(201).json({ id: orderId, message: 'سفارش ثبت شد', user_id: finalUserId });
  } catch (err) {
    console.error('Manual order error:', err.message);
    res.status(500).json({ message: 'خطای سرور', error: err.message });
  }
});

// ── POST /api/orders ──
router.post('/', auth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { items } = req.body; // [{product_id, quantity}]
    if (!items?.length) return res.status(400).json({ message: 'اقلام سفارش خالی است' });

    await conn.beginTransaction();

    let total = 0;
    const orderItems = [];

    for (const item of items) {
      const [[product]] = await conn.execute(
        'SELECT * FROM products WHERE id=? AND status="active" AND stock>=?',
        [item.product_id, item.quantity]
      );
      if (!product) throw new Error(`محصول ${item.product_id} موجود نیست`);
      const itemTotal = product.price * item.quantity;
      total += itemTotal;
      orderItems.push({ product, quantity: item.quantity, price: product.price, total: itemTotal });
    }

    const [result] = await conn.execute(
      'INSERT INTO orders (user_id, total, status) VALUES (?,?,?)',
      [req.user.id, total, 'pending_expert']
    );
    const orderId = result.insertId;

    for (const item of orderItems) {
      await conn.execute(
        'INSERT INTO order_items (order_id,product_id,quantity,price,total) VALUES (?,?,?,?,?)',
        [orderId, item.product.id, item.quantity, item.price, item.total]
      );
      await conn.execute('UPDATE products SET stock=stock-? WHERE id=?', [item.quantity, item.product.id]);
    }

    await conn.commit();

    // Check low stock and notify admin
    for (const item of orderItems) {
      const [[updated]] = await db.execute('SELECT stock, description FROM products WHERE id=?', [item.product.id]);
      if (updated && updated.stock <= 5 && updated.stock >= 0) {
        await SMS.notifyAdmin('notif_low_stock', `موجودی محصول "${updated.description}" کم شد (${updated.stock} عدد باقی‌مانده).`);
      }
    }

    // Get user info for SMS
    const [[user]] = await db.execute('SELECT * FROM users WHERE id=?', [req.user.id]);
    await SMS.orderConfirmed(user.phone, user.name || 'کاربر', orderId);
    await createNotif('order', `سفارش جدید #${orderId}`, `${user.name||user.phone} یک سفارش جدید ثبت کرد`, '/admin/orders.html');
    await createUserNotification(req.user.id, 'درخواست شما ثبت شد', `درخواست #${orderId} ثبت شد و منتظر تأیید درخواست باشید.`, 'info', '/orders.html', 'order_submitted');

    res.status(201).json({ id: orderId, total, message: 'سفارش ثبت شد' });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ message: err.message || 'خطا در ثبت سفارش' });
  } finally {
    conn.release();
  }
});

// ── PATCH /api/orders/:id/approve ── (admin) - expert approval with clear confirmation SMS
router.patch('/:id/approve', adminAuth, async (req, res) => {
  try {
    const [[order]] = await db.execute('SELECT o.*,u.phone,u.name FROM orders o JOIN users u ON o.user_id=u.id WHERE o.id=?', [req.params.id]);
    if (!order) return res.status(404).json({ message: 'سفارش یافت نشد' });

    await db.execute('UPDATE orders SET status="pending_customer" WHERE id=?', [req.params.id]);

    // Don't add debt here - wait for customer to approve the invoice

    const customerName = order.name || 'کاربر گرامی';
    await SMS.orderApproved(order.phone, order.name || 'کاربر', req.params.id);
    await notifyOrderStatus(order, 'pending_customer');

    res.json({ message: 'سفارش تایید شد', status: 'pending_customer' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/orders/:id/deliver ── (admin) - confirm delivery with code
router.patch('/:id/deliver', adminAuth, async (req, res) => {
  try {
    const { delivery_code } = req.body;
    if(!delivery_code) return res.status(400).json({ message: 'کد تحویل الزامی است' });

    const [[order]] = await db.execute(
      'SELECT o.*,u.phone,u.name FROM orders o JOIN users u ON o.user_id=u.id WHERE o.id=?',
      [req.params.id]
    );
    if(!order) return res.status(404).json({ message: 'سفارش یافت نشد' });

    // For driver methods, verify code
    if(order.delivery_code && order.delivery_code !== String(delivery_code)){
      return res.status(400).json({ message: 'کد تحویل اشتباه است' });
    }

    await db.execute('UPDATE orders SET status="delivered" WHERE id=?', [req.params.id]);
    await SMS.orderDelivered(order.phone, order.name||'کاربر', delivery_code);
    await notifyOrderStatus(order, 'delivered');

    res.json({ message: 'سفارش تحویل داده شد' });
  } catch(err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/orders/:id/ship ── (admin) - set shipping info and generate delivery code
router.patch('/:id/ship', adminAuth, async (req, res) => {
  try {
    const { shipping_method, shipping_tracking, shipping_driver_name, shipping_driver_phone, shipping_vehicle, shipping_plate, shipping_packages } = req.body;
    if (!shipping_method) return res.status(400).json({ message: 'روش ارسال الزامی است' });

    // Generate random 6-digit delivery code only for driver methods
    const needsDeliveryCode = !['post','tipax'].includes(shipping_method);
    const delivery_code = needsDeliveryCode ? Math.floor(100000 + Math.random() * 900000).toString() : null;

    await db.execute(
      `UPDATE orders SET status='shipping', shipping_method=?, shipping_tracking=?, shipping_driver_name=?, shipping_driver_phone=?, shipping_vehicle=?, shipping_plate=?, shipping_packages=?, delivery_code=? WHERE id=?`,
      [shipping_method, shipping_tracking||'', shipping_driver_name||'', shipping_driver_phone||'', shipping_vehicle||'', shipping_plate||'', shipping_packages||1, delivery_code, req.params.id]
    );

    const [[order]] = await db.execute('SELECT o.*,u.phone,u.name FROM orders o JOIN users u ON o.user_id=u.id WHERE o.id=?', [req.params.id]);

    if(order){
      try{
        const packagesCount = shipping_packages || 1;
        if(shipping_method === 'post' || shipping_method === 'tipax'){
          await SMS.shippingPost(order.phone, order.name||'کاربر', req.params.id, shipping_tracking||'—', shipping_method);
        } else {
          await SMS.shippingDriver(order.phone, order.name||'کاربر', req.params.id, shipping_driver_name, shipping_driver_phone, shipping_vehicle||shipping_method, shipping_plate, packagesCount, delivery_code);
        }
      } catch(smsErr){
        console.error('Ship SMS error:', smsErr.message);
      }
      await notifyOrderStatus(order, 'shipping');
    }

    res.json({ message: 'اطلاعات ارسال ثبت شد', delivery_code });
  } catch (err) {
    console.error('Ship error:', err.message, err.stack);
    res.status(500).json({ message: 'خطای سرور', detail: err.message });
  }
});

// ── PATCH /api/orders/:id/status ── (admin)
router.patch('/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, clear_shipping } = req.body;
    const validStatuses = ['pending_expert','pending_customer','pending_payment','preparing','shipping','delivered','cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ message: 'وضعیت نامعتبر' });

    if(clear_shipping){
      await db.execute(
        `UPDATE orders SET status=?, shipping_method=NULL, shipping_tracking=NULL, shipping_driver_name=NULL, shipping_driver_phone=NULL, shipping_vehicle=NULL, shipping_plate=NULL, shipping_packages=NULL, delivery_code=NULL WHERE id=?`,
        [status, req.params.id]
      );
    } else {
      await db.execute('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
    }

    // Send SMS to user for every status change
    const [[order]] = await db.execute('SELECT o.*,u.phone,u.name FROM orders o JOIN users u ON o.user_id=u.id WHERE o.id=?', [req.params.id]);
    if (order) {
      const name = order.name || 'کاربر';
      const id = req.params.id;
      if (status === 'preparing') await SMS.orderPreparing(order.phone, name, id);
      else if (status === 'cancelled') {
        await SMS.orderRejected(order.phone, name, id);
        // Remove debt if order had been approved (debt was added)
        await db.execute('UPDATE users SET debt=GREATEST(0, debt-?) WHERE id=?', [order.total||0, order.user_id]);
      }
      else if (status === 'pending_payment') await SMS.orderApproved(order.phone, name, id);
      await notifyOrderStatus(order, status);
    }

    res.json({ message: 'وضعیت سفارش تغییر کرد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/orders/:id ── (admin) - fully remove order and related data
router.delete('/:id', adminAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM order_items WHERE order_id=?', [req.params.id]);
    await conn.execute('DELETE FROM invoices WHERE order_id=?', [req.params.id]).catch(()=>{});
    const [result] = await conn.execute('DELETE FROM orders WHERE id=?', [req.params.id]);
    await conn.commit();
    if (!result.affectedRows) return res.status(404).json({ message: 'سفارش یافت نشد' });
    res.json({ message: 'سفارش حذف شد' });
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
  const conn = await db.getConnection();
  try {
    const { items, overall_discount } = req.body; // [{product_id, quantity, price, discount}]
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: 'حداقل یک قلم الزامی است' });

    await conn.beginTransaction();

    await conn.execute('DELETE FROM order_items WHERE order_id=?', [req.params.id]);

    let subtotal = 0;
    for (const item of items) {
      const itemDiscount = Number(item.discount) || 0;
      const lineTotal = Math.round(item.quantity * item.price * (1 - itemDiscount / 100));
      subtotal += lineTotal;
      await conn.execute(
        'INSERT INTO order_items (order_id,product_id,quantity,price,discount,total) VALUES (?,?,?,?,?,?)',
        [req.params.id, item.product_id, item.quantity, item.price, itemDiscount, lineTotal]
      );
    }

    const overallDiscount = Number(overall_discount) || 0;
    const finalTotal = Math.round(subtotal * (1 - overallDiscount / 100));

    await conn.execute('UPDATE orders SET total=?, discount_percent=? WHERE id=?', [finalTotal, overallDiscount, req.params.id]);
    await conn.commit();

    res.json({ message: 'فاکتور به‌روزرسانی شد', total: finalTotal });
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
  try {
    const [[order]] = await db.execute('SELECT * FROM orders WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!order) return res.status(404).json({ message: 'سفارش یافت نشد' });
    if (order.status !== 'pending_customer') return res.status(400).json({ message: 'این سفارش در وضعیت قابل تایید نیست' });

    await db.execute('UPDATE orders SET status="pending_payment" WHERE id=?', [req.params.id]);

    // Add order total to user's debt (only for regular users)
    const [[user]] = await db.execute('SELECT role FROM users WHERE id=?', [order.user_id]);
    if(user && user.role === 'user'){
      await db.execute('UPDATE users SET debt=debt+? WHERE id=?', [order.total||0, order.user_id]);
    }
    await notifyOrderStatus(order, 'pending_payment');

    res.json({ message: 'فاکتور تایید شد', status: 'pending_payment' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PATCH /api/orders/:id/customer-reject ── (customer rejects invoice)
router.patch('/:id/customer-reject', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const [[order]] = await db.execute('SELECT * FROM orders WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!order) return res.status(404).json({ message: 'سفارش یافت نشد' });
    if (order.status !== 'pending_customer') return res.status(400).json({ message: 'این سفارش در وضعیت قابل رد نیست' });

    await db.execute('UPDATE orders SET status="cancelled" WHERE id=?', [req.params.id]);
    await notifyOrderStatus(order, 'cancelled');

    res.json({ message: 'فاکتور رد شد', status: 'cancelled' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
