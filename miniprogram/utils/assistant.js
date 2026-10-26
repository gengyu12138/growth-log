const dates = require('./date');
const { statistics } = require('./cards');
function storageKey(member) { return 'assistantViews:' + member._id + ':' + member.family_code; }
function readViews(wx, member) {
  const saved = wx.getStorageSync(storageKey(member));
  if (!saved) return [];
  if (!Array.isArray(saved) || saved.length > 20 || saved.some((item) => !item || !['board', 'tracker', 'compare'].includes(item.intent)
    || typeof item.title !== 'string' || !item.window || !Array.isArray(item.types) || !Array.isArray(item.keywords) || !Array.isArray(item.fields))) {
    throw new Error('本机保存的视图格式异常，请检查后重试');
  }
  return saved;
}
function saveView(wx, member, plan) {
  if (!['board', 'tracker', 'compare'].includes(plan.intent)) throw new Error('此结果不支持保存视图');
  const item = { intent: plan.intent, title: plan.title, window: plan.window, types: plan.types,
    keywords: plan.keywords, fields: plan.fields, warning: '', question: '', candidates: [] };
  const views = readViews(wx, member);
  const index = views.findIndex((view) => JSON.stringify(view) === JSON.stringify(item));
  if (index >= 0) return views;
  if (views.length >= 20) throw new Error('最多保存20个视图，请先移除不需要的视图');
  views.push(item); wx.setStorageSync(storageKey(member), views); return views;
}
function match(row, plan) {
  return !row.deleted_at && !row.planned && row.happened_on >= plan.start && row.happened_on <= plan.end
    && (!plan.types.length && !plan.keywords.length || plan.types.includes(row.card && row.card.type)
      || plan.keywords.some((word) => (row.content || '').includes(word)));
}
const round = (value) => Number(value.toFixed(6));
function metrics(summary, fields) {
  return summary.groups.flatMap((group) => group.metrics.filter((m) => !fields.length || fields.includes(m.label)).map((metric) => {
    const daily = new Map();
    metric.sources.forEach((source) => {
      if (!daily.has(source.date)) daily.set(source.date, source.value);
      else if (metric.additive) daily.set(source.date, round(daily.get(source.date) + source.value));
    });
    const points = [...daily].sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
    const maximum = Math.max(1, ...points.map((p) => Math.abs(p[1])));
    return Object.assign({}, metric, { type: group.type, key: JSON.stringify([group.type, metric.label, metric.unit]),
      value: metric.additive ? metric.total : metric.latest,
      trend: points.map(([date, value]) => ({ date: date.slice(5), value, width: Math.max(2, Math.abs(value) / maximum * 100) })) });
  }));
}
async function report(app, plan, member, cancelled) {
  const start = plan.intent === 'compare' ? plan.previousStart : plan.start, rows = [], seen = new Set();
  let month = start.slice(0, 7);
  while (month <= plan.end.slice(0, 7)) {
    const batch = await app.collectEntries({ month }, member.family_code, cancelled);
    if (cancelled()) throw new Error('已取消读取');
    for (const row of batch) {
      if (seen.has(row._id)) throw new Error('读取期间记录变化，请重试');
      seen.add(row._id); rows.push(row);
      if (rows.length > 10000) throw new Error('记录较多，请缩小日期范围');
    }
    const [year, value] = month.split('-').map(Number);
    month = value === 12 ? (year + 1) + '-01' : year + '-' + dates.pad(value + 1);
  }
  const current = rows.filter((r) => match(r, plan));
  const summary = statistics(current, plan.start, plan.end), currentMetrics = metrics(summary, plan.fields);
  const previous = plan.intent === 'compare' ? rows.filter((r) => match(r, Object.assign({}, plan, { start: plan.previousStart, end: plan.previousEnd }))) : [];
  const old = statistics(previous, plan.previousStart, plan.previousEnd), oldMetrics = metrics(old, plan.fields);
  const combined = currentMetrics.map((metric) => {
    const before = oldMetrics.find((m) => m.key === metric.key);
    const delta = before ? round(metric.value - before.value) : null;
    return Object.assign({}, metric, { previous: before ? before.value : null, previousCount: before ? before.count : 0,
      delta, percent: before && before.value !== 0 ? round(delta / Math.abs(before.value) * 100) : null,
      previousSources: before ? before.sources : [] });
  });
  oldMetrics.filter((m) => !combined.some((item) => item.key === m.key)).forEach((m) => combined.push(Object.assign({}, m, {
    value: null, count: 0, sources: [], trend: [], previous: m.value, previousCount: m.count,
    previousSources: m.sources, delta: null, percent: null })));
  return { count: summary.total, structured: summary.structured, previousCount: old.total, previousStructured: old.structured,
    days: new Set(current.map((r) => r.happened_on)).size, previousDays: new Set(previous.map((r) => r.happened_on)).size,
    metrics: combined, rows: current, previousRows: previous };
}
module.exports = { storageKey, readViews, saveView, report };
