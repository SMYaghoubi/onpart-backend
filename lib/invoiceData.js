function invoiceTotals(items, orderTotal) {
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.price) || 0), 0);
  const total = Math.max(0, Number(orderTotal) || 0);
  return { subtotal, discount: Math.max(0, subtotal - total), total };
}

module.exports = { invoiceTotals };
