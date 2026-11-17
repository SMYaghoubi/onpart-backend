const { createHash } = require('node:crypto');
const { normalizeProductText } = require('./productSearch');

const FILTER_GROUPS = Object.freeze(['cars', 'brands', 'categories']);
const SETTING_PREFIX = 'shop-filter:';
const filterKey = value => normalizeProductText(value, { compact: true });
const cleanLabel = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const validLabel = value => value.length <= 500 && Boolean(filterKey(value));

function parseFilterRule(input) {
  const { group, hidden } = input ?? {};
  const source = cleanLabel(input?.source);
  const label = cleanLabel(input?.label);
  if (!FILTER_GROUPS.includes(group) || !validLabel(source) || !validLabel(label) || typeof hidden !== 'boolean') {
    return null;
  }
  return { group, source, label, hidden };
}

function filterSettingKey(rule) {
  const hash = createHash('sha256').update(filterKey(rule.source)).digest('hex');
  return SETTING_PREFIX + rule.group + ':' + hash;
}

function buildShopFilters(metadata, settings, management) {
  const groups = Object.fromEntries(FILTER_GROUPS.map(group => [
    group, new Map(metadata[group].map(source => [filterKey(source), { source, label: source, hidden: false }]))
  ]));
  for (const setting of settings) {
    let rule;
    try { rule = parseFilterRule(JSON.parse(setting.value)); }
    catch { continue; }
    if (!rule || setting.key !== filterSettingKey(rule)) continue;
    const { group, ...entry } = rule;
    groups[group].set(filterKey(entry.source), entry);
  }

  const result = {};
  const labels = {};
  const collator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' });
  for (const group of FILTER_GROUPS) {
    const entries = [...groups[group].values()].sort((a, b) => collator.compare(a.label, b.label));
    if (management) {
      result[group] = entries;
      continue;
    }
    const visible = entries.filter(entry => !entry.hidden);
    result[group] = visible.map(entry => entry.source);
    labels[group] = Object.fromEntries(visible.filter(entry => entry.source !== entry.label)
      .map(entry => [entry.source, entry.label]));
  }
  if (!management && Object.values(labels).some(group => Object.keys(group).length)) result.labels = labels;
  return result;
}

module.exports = { SETTING_PREFIX, buildShopFilters, filterSettingKey, parseFilterRule };
