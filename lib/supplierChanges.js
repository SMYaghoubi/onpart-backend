function buildSupplierChange(product, rawPrice, rawStock) {
  if (!product) throw new Error('محصول یافت نشد');
  const hasPrice = rawPrice !== '' && rawPrice != null;
  const hasStock = rawStock !== '' && rawStock != null;
  const price = hasPrice ? Number(rawPrice) : Number(product.price || 0);
  const stock = hasStock ? Number(rawStock) : null;
  if (!Number.isInteger(price) || price < 0) throw new Error('قیمت نامعتبر است');
  if (stock != null && (!Number.isInteger(stock) || stock < 0)) throw new Error('موجودی نامعتبر است');
  const priceChanged = hasPrice && price !== Number(product.price || 0);
  const stockChanged = hasStock && stock !== Number(product.stock || 0);
  if (!priceChanged && !stockChanged) return null;
  return { supplierPrice: price, stock: stockChanged ? stock : null, priceChanged, stockChanged };
}

module.exports = { buildSupplierChange };
