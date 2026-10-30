function normalized(text) { return String(text || '').toLowerCase().replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()]/g, ''); }
function similarity(a, b) {
  a = normalized(a); b = normalized(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) < 6) return 0;
  const grams = (s) => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
  const x = grams(a), y = grams(b), overlap = [...x].filter((value) => y.has(value)).length;
  return 2 * overlap / (x.size + y.size);
}
function candidates(rows, value, excludeId) {
  return rows.filter((row) => {
    if (row._id === excludeId || row.deleted_at || row.happened_on !== value.happened_on || !!row.planned !== !!value.planned) return false;
    if (row.at && value.at && row.at !== value.at) return false;
    return similarity(row.content, value.content) >= .82 || (row.images || []).some((image) => (value.images || []).includes(image));
  }).slice(0, 3);
}
function pairs(rows) {
  const result = [], seen = new Set();
  for (const row of rows) for (const other of candidates(rows, row, row._id)) {
    const key = [row._id, other._id].sort().join(':');
    if (seen.has(key)) continue;
    seen.add(key); result.push({ key, first: row, second: other });
    if (result.length >= 50) return result;
  }
  return result;
}
module.exports = { candidates, pairs, similarity };
