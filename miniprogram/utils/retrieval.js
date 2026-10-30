function match(row, plan) {
  const text = [row.content, row.note, row.card && row.card.type, ...(row.tags || [])].filter(Boolean).join(' ').toLowerCase();
  return !row.deleted_at && (plan.scope === 'all' || (plan.scope === 'plans' ? row.planned === true : !row.planned))
    && (!plan.start || row.happened_on >= plan.start) && (!plan.end || row.happened_on <= plan.end)
    && (!plan.kind || row.kind === plan.kind)
    && (!plan.keywords.length && !plan.types.length || plan.types.includes(row.card && row.card.type)
      || plan.keywords.some((word) => text.includes(word.toLowerCase())));
}
function select(rows, plan) {
  const hits = rows.filter((row) => match(row, plan)).sort((a, b) => (a.happened_on + (a.at || '')).localeCompare(b.happened_on + (b.at || '')));
  if (!hits.length || plan.selection === 'all') return { rows: hits, answer: '', total: hits.length };
  const day = hits[plan.selection === 'first' ? 0 : hits.length - 1].happened_on;
  return { rows: hits.filter((row) => row.happened_on === day), total: hits.length,
    answer: '已记录的' + (plan.selection === 'first' ? '最早' : '最近') + '日期：' + day };
}
module.exports = { match, select };
