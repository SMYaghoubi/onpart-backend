function calculateProfit(rows) {
  const totals = rows.reduce((result, row) => {
    const quantity = Math.max(0, Number(row.quantity) || 0);
    result.sales += Math.max(0, Number(row.total) || 0);
    result.cost += Math.max(0, Number(row.cost_price) || 0) * quantity;
    return result;
  }, { sales: 0, cost: 0 });
  totals.profit = totals.sales - totals.cost;
  totals.percent = totals.sales ? Math.round(totals.profit * 10000 / totals.sales) / 100 : 0;
  return totals;
}

function fillSevenDays(rows, now = new Date()) {
  const values = new Map((rows || []).map(row => [String(row.day).slice(0, 10), Number(row.sales) || 0]));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const day = date.toISOString().slice(0, 10);
    return { day, sales: values.get(day) || 0 };
  });
}
module.exports = { calculateProfit, fillSevenDays };
