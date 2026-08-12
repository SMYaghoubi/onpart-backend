const router = require('express').Router();
const db     = require('../config/database');
const { auth } = require('../middleware/auth');
const { isProductAvailable, normalizeCartItem, normalizeCartItems } = require('../lib/cartValidation');

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
    const normalized = normalizeCartItems(req.body && req.body.items);
    if (!normalized.valid) return res.status(400).json({ message: normalized.message });
    const items = normalized.items;

    await conn.beginTransaction();
    if (items.length) {
      const ids = items.map(item => item.product_id);
      const placeholders = ids.map(() => '?').join(',');
      const [products] = await conn.execute(
        `SELECT id, stock, status FROM products WHERE id IN (${placeholders}) FOR UPDATE`,
        ids
      );
      const availabilityById = new Map(products.map(product => [Number(product.id), isProductAvailable(product)]));
      for (const item of items) {
        if (!availabilityById.has(item.product_id)) {
          await conn.rollback();
          return res.status(404).json({ message: 'یکی از محصولات یافت نشد' });
        }
        if (!availabilityById.get(item.product_id)) {
          await conn.rollback();
          return res.status(409).json({ message: 'یکی از محصولات ناموجود است' });
        }
      }
    }
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
    const normalized = normalizeCartItem(req.body);
    if (!normalized.valid) return res.status(400).json({ message: normalized.message });
    const { product_id, quantity } = normalized.item;

    if (quantity === 0) {
      await db.execute('DELETE FROM cart_items WHERE user_id=? AND product_id=?', [req.user.id, product_id]);
    } else {
      const [[product]] = await db.execute('SELECT id, stock, status FROM products WHERE id=?', [product_id]);
      if (!product) return res.status(404).json({ message: 'محصول یافت نشد' });
      if (!isProductAvailable(product)) {
        return res.status(409).json({ message: 'این کالا ناموجود است' });
      }
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
