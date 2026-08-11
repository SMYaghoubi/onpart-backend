function normalizeBrand(value) {
  return String(value == null ? '' : value).normalize('NFC').trim();
}

function brandKey(value) {
  return normalizeBrand(value).toLocaleLowerCase('fa-IR');
}

function mapSupplierBrands(rows) {
  const brands = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const brand = normalizeBrand(row.brand != null ? row.brand : row.brand_name);
    if (!brand) continue;
    const key = brandKey(brand);
    const count = Math.max(0, Number(row.product_count) || 0);
    const current = brands.get(key);
    if (current) current.product_count += count;
    else brands.set(key, { brand, product_count: count });
  }
  return [...brands.values()].sort((a,b) => a.brand.localeCompare(b.brand, 'fa', { sensitivity:'base', numeric:true }));
}

module.exports = { normalizeBrand, brandKey, mapSupplierBrands };
