function calculateFinalPrice(supplierPrice, markupPercent) {
  const price = Number(supplierPrice);
  const percent = Number(markupPercent);
  if (!Number.isInteger(price) || price < 0) throw new Error('قیمت تأمین‌کننده نامعتبر است');
  if (!Number.isFinite(percent) || percent < 0 || percent > 1000) throw new Error('درصد افزایش نامعتبر است');
  return Math.round(price * (1 + percent / 100));
}

function validateSupplierValues(supplierPrice, stock) {
  const price = Number(supplierPrice);
  const proposedStock = stock === '' || stock == null ? null : Number(stock);
  if (!Number.isInteger(price) || price < 0) throw new Error('قیمت تأمین‌کننده نامعتبر است');
  if (proposedStock != null && (!Number.isInteger(proposedStock) || proposedStock < 0)) {
    throw new Error('موجودی پیشنهادی نامعتبر است');
  }
  return { supplierPrice: price, stock: proposedStock };
}

function isProductInAllowedBrands(product, allowedBrands) {
  return Boolean(product && allowedBrands && allowedBrands.has(String(product.brand || '').trim()));
}

module.exports = { calculateFinalPrice, validateSupplierValues, isProductInAllowedBrands };
