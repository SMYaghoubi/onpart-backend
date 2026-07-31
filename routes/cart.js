const router = require('express').Router();
const db     = require('../config/database');
const { auth } = require('../middleware/auth');

// ── GET /api/cart ── (get current user's cart with product details)
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT c.product_id, c.quantity, p.description, p.code, p.price, p.stock, p.car, p.brand
       FROM cart_items c
       LEFT JOIN products p ON c.product_id = p.id
       WHERE c.user_id = ?`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── PUT /api/cart ── (replace entire cart - used when syncing)
router.put('/', auth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { items } = req.body; // [{product_id, quantity}]
    if (!Array.isArray(items)) return res.status(400).json({ message: 'فرمت نامعتبر' });

    await conn.beginTransaction();
    await conn.execute('DELETE FROM cart_items WHERE user_id=?', [req.user.id]);

    for (const item of items) {
      if (item.quantity > 0) {
        await conn.execute(
          'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?,?,?)',
          [req.user.id, item.product_id, item.quantity]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'سبد خرید بروزرسانی شد' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'خطا در بروزرسانی سبد خرید' });
  } finally {
    conn.release();
  }
});

// ── PATCH /api/cart/item ── (update single item quantity)
router.patch('/item', auth, async (req, res) => {
  try {
    const { product_id, quantity } = req.body;
    if (!product_id) return res.status(400).json({ message: 'محصول مشخص نشده' });

    if (quantity <= 0) {
      await db.execute('DELETE FROM cart_items WHERE user_id=? AND product_id=?', [req.user.id, product_id]);
    } else {
      await db.execute(
        `INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE quantity=?`,
        [req.user.id, product_id, quantity, quantity]
      );
    }
    res.json({ message: 'بروزرسانی شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

// ── DELETE /api/cart ── (clear cart, e.g. after checkout)
router.delete('/', auth, async (req, res) => {
  try {
    await db.execute('DELETE FROM cart_items WHERE user_id=?', [req.user.id]);
    res.json({ message: 'سبد خرید خالی شد' });
  } catch (err) {
    res.status(500).json({ message: 'خطای سرور' });
  }
});

module.exports = router;
