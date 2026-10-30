const { ageLabel, recordedTimeLabel, entryTime, fmtTime } = require('./date');

function present(entry, birthday, preview = false, compact = false) {
  const card = entry.card;
  const fields = card && Array.isArray(card.fields) ? card.fields : [];
  const p = card && card.presentation;
  let layout = 'story';
  if (entry.kind === 'first' || card && card.type === '里程碑') layout = 'milestone';
  else if (entry.kind === 'health' || card && card.type === '健康') layout = 'health';
  else if (card && card.interval) layout = 'interval';
  else if (fields.some((f) => typeof f.value === 'number')) layout = 'metrics';
  else if (fields.length) layout = 'list';
  if (p && ['story', 'metrics', 'interval', 'milestone', 'health', 'list'].includes(p.layout)) layout = p.layout;
  const images = Array.isArray(entry.images) ? entry.images : [];
  if (images.length && layout === 'story') layout = 'photo';
  const showMetrics = ['metrics', 'health', 'interval'].includes(layout);
  const primary = fields.find((field) => typeof field.value === 'number' && p && p.primary === field.label)
    || fields.find((field) => typeof field.value === 'number');
  const visibleFields = fields.slice(0, 6).map((field) => Object.assign({}, field, { primary: field === primary }));
  const excerptLength = compact ? 64 : 100;
  const metrics = showMetrics ? visibleFields.filter((field) => typeof field.value === 'number') : [];
  const labels = { daily: '日常', first: '第一次', health: '健康' };
  return {
    layout, type: card && card.type || labels[entry.kind] || '日常',
    title: p && p.title && (entry.content || '').includes(p.title) ? p.title : '',
    text: entry.content || '', long: (entry.content || '').length > excerptLength,
    excerpt: (entry.content || '').length > excerptLength ? entry.content.slice(0, excerptLength) + '…' : entry.content || '',
    time: entryTime(entry) || (preview ? fmtTime(Date.now()) : ''),
    timeFallback: !entry.at, savedTime: entry.at || preview ? '' : recordedTimeLabel(entry.created_at),
    age: birthday ? ageLabel(birthday, entry.happened_on) : entry.ageLabel || '',
    images, previewImages: images.slice(0, 3), metrics, compactMetrics: metrics.slice().sort((a, b) => Number(b.primary) - Number(a.primary)).slice(0, 2),
    facts: visibleFields.filter((field) => !showMetrics || typeof field.value !== 'number'),
    start: card && card.interval ? card.interval.start.replace('T', ' ') : '',
    end: card && card.interval ? card.interval.end.replace('T', ' ') : '',
  };
}

module.exports = { present };
