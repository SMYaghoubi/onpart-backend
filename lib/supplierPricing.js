function calculateFinalPrice(supplierPrice, markupPercent) {
  const price = Number(supplierPrice);
  const percent = Number(markupPercent);
  if (!Number.isInteger(price) || price < 0) throw new Error('قیمت تأمین‌کننده نامعتبر است');
  if (!Number.isFinite(percent) || percent < 0 || percent > 1000) throw new Error('درصد افزایش نامعتبر است');
  return Math.round(price * (1 + percent / 100));
}

function validateSupplierValues(supplierPrice, available, currentStock = 0) {
  const { parseAvailability, stockForAvailability } = require('./productAvailability');
  const price = Number(supplierPrice);
  if (!Number.isInteger(price) || price < 0) throw new Error('قیمت تأمین‌کننده نامعتبر است');
  if (available === '' || available == null) return { supplierPrice:price, stock:null, available:null };
  const normalized=parseAvailability(available).available;
  return { supplierPrice:price, stock:stockForAvailability(currentStock,normalized), available:normalized };
}
function isProductInAllowedBrands(product, allowedBrands) {
  return Boolean(product && allowedBrands && allowedBrands.has(String(product.brand || '').trim()));
}

module.exports = { calculateFinalPrice, validateSupplierValues, isProductInAllowedBrands };
