const MAX_CART_LINES = 200;
const MAX_ITEM_QUANTITY = 9999;

function normalizeCartItem(input) {
  const productId = Number(input && input.product_id);
  const quantity = Number(input && input.quantity);
  if (!Number.isInteger(productId) || productId <= 0) {
    return { valid: false, message: 'شناسه محصول نامعتبر است' };
  }
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_ITEM_QUANTITY) {
    return { valid: false, message: 'تعداد کالا نامعتبر است' };
  }
  return { valid: true, item: { product_id: productId, quantity } };
}

function normalizeCartItems(items) {
  if (!Array.isArray(items)) return { valid: false, message: 'فرمت سبد خرید نامعتبر است' };
  if (items.length > MAX_CART_LINES) return { valid: false, message: 'تعداد اقلام سبد بیش از حد مجاز است' };
  const normalized = [];
  const seen = new Set();
  for (const raw of items) {
    const result = normalizeCartItem(raw);
    if (!result.valid) return result;
    if (seen.has(result.item.product_id)) {
      return { valid: false, message: 'محصول تکراری در سبد خرید وجود دارد' };
    }
    seen.add(result.item.product_id);
    if (result.item.quantity > 0) normalized.push(result.item);
  }
  return { valid: true, items: normalized };
}

module.exports = { MAX_CART_LINES, MAX_ITEM_QUANTITY, normalizeCartItem, normalizeCartItems };
