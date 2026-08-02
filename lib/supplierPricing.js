function calculateFinalPrice(supplierPrice, markupPercent) {
  const price = Number(supplierPrice);
  const percent = Number(markupPercent);
  if (!Number.isInteger(price) || price < 0) throw new Error('قیمت تأمین‌کننده نامعتبر است');
  if (!Number.isFinite(percent) || percent < 0 || percent > 1000) throw new Error('درصد افزایش نامعتبر است');
  return Math.round(price * (1 + percent / 100));
}

module.exports = { calculateFinalPrice };
