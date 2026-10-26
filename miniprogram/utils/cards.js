const { fmtTime, recordedTimeLabel } = require('./date');
const CONVERSIONS = {
  '毫升': ['毫升', 1, true], ml: ['毫升', 1, true], mL: ['毫升', 1, true], '升': ['毫升', 1000, true], L: ['毫升', 1000, true],
  '分钟': ['分钟', 1, true], '小时': ['分钟', 60, true], '次': ['次', 1, true],
  '公斤': ['公斤', 1, false], '千克': ['公斤', 1, false], kg: ['公斤', 1, false], '克': ['公斤', .001, false], g: ['公斤', .001, false], '斤': ['公斤', .5, false],
  '厘米': ['厘米', 1, false], cm: ['厘米', 1, false], '米': ['厘米', 100, false], m: ['厘米', 100, false],
  '℃': ['℃', 1, false], '度': ['℃', 1, false],
};
const round = (value) => Number(value.toFixed(6));
function source(entry, field) {
  return { id: entry._id, revision: entry.revision || 0, date: entry.happened_on, at: entry.at || (Number.isFinite(entry.created_at) ? fmtTime(entry.created_at) : ''),
    timeLabel: entry.at || recordedTimeLabel(entry.created_at),
    content: entry.content || '照片记录', evidence: field ? field.evidence || '' : '', manual: field && field.manual === true };
}
function statistics(rows, start, end) {
  const entries = rows.filter((e) => !e.deleted_at && !e.planned && e.happened_on >= start && e.happened_on <= end);
  const seen = new Set(), groups = new Map();
  let structured = 0;
  for (const entry of entries) {
    if (seen.has(entry._id)) throw new Error('记录重复，请重新读取统计');
    seen.add(entry._id);
    if (!entry.card) continue;
    if (typeof entry.card.type !== 'string' || !Array.isArray(entry.card.fields)) throw new Error('卡片格式异常，请检查原记录');
    structured += 1;
    const type = entry.card.type;
    if (!groups.has(type)) groups.set(type, { type, sources: [], metrics: new Map() });
    const group = groups.get(type);
    group.sources.push(source(entry));
    for (const field of entry.card.fields) {
      if (typeof field.value !== 'number') continue;
      if (!Number.isFinite(field.value)) throw new Error('记录数值异常，无法统计');
      const conversion = (field.unit === '度' && field.label !== '体温' ? null : CONVERSIONS[field.unit]) || [field.unit, 1, false];
      const [unit, factor, additive] = conversion, value = round(field.value * factor);
      const key = JSON.stringify([field.label, unit]);
      if (!group.metrics.has(key)) group.metrics.set(key, { label: field.label, unit, additive, sources: [] });
      group.metrics.get(key).sources.push(Object.assign(source(entry, field), { value,
        expression: `${field.value}${field.unit}${factor === 1 ? '' : ' → ' + value + unit}` }));
    }
  }
  const output = [...groups.values()].map((group) => {
    const metrics = [...group.metrics.values()].map((metric) => {
      const sources = metric.sources.sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at) || b.id.localeCompare(a.id));
      const values = sources.map((s) => s.value), total = values.reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(total) || Math.abs(total) > Number.MAX_SAFE_INTEGER) throw new Error('统计数值超出精度范围');
      return Object.assign({}, metric, { sources, count: sources.length, total: round(total), average: round(total / sources.length),
        min: Math.min(...values), max: Math.max(...values), latest: sources[0].value });
    });
    return { type: group.type, count: group.sources.length, sources: group.sources, metrics };
  });
  return { groups: output, total: entries.length, structured, start, end };
}
function editField(card, index, value, remove) {
  const fields = card.fields.map((field) => Object.assign({}, field));
  const field = fields[index];
  if (!field || field.computed) return card;
  if (remove) fields.splice(index, 1);
  else {
    field.numeric = field.numeric === true || typeof field.value === 'number';
    field.value = field.numeric && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value;
    field.manual = true;
  }
  return Object.assign({}, card, { fields });
}
function clearInterval(card) {
  return card && card.interval ? Object.assign({}, card, { interval: null, fields: card.fields.filter((field) => !field.computed) }) : card;
}
module.exports = { statistics, editField, clearInterval };
