const { parseAvailability, stockForAvailability } = require('./productAvailability');

function buildSupplierChange(product, rawPrice, rawAvailability) {
  if (!product) throw new Error('محصول یافت نشد');
  const hasPrice = rawPrice !== '' && rawPrice != null;
  const hasAvailability = rawAvailability !== '' && rawAvailability != null;
  const price = hasPrice ? Number(rawPrice) : Number(product.price || 0);
  if (!Number.isInteger(price) || price < 0) throw new Error('قیمت نامعتبر است');
  const available = hasAvailability ? parseAvailability(rawAvailability).available : null;
  const priceChanged = hasPrice && price !== Number(product.price || 0);
  const availabilityChanged = hasAvailability && available !== (Number(product.stock)>0);
  if (!priceChanged && !availabilityChanged) return null;
  return {
    supplierPrice: price,
    stock: availabilityChanged ? stockForAvailability(product.stock,available) : null,
    available: availabilityChanged ? available : null,
    priceChanged,
    availabilityChanged
  };
}

module.exports = { buildSupplierChange };