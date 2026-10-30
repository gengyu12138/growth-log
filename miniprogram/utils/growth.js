function summarize(rows, month) {
  const entries = rows.filter((e) => !e.deleted_at && !e.planned && e.happened_on.slice(0, 7) === month);
  const firsts = entries.filter((e) => e.kind === 'first');
  const favorites = entries.filter((e) => e.favorite);
  const images = [...new Set(entries.reduce((all, e) => all.concat(e.images || []), []))];
  const days = new Set(entries.map((e) => e.happened_on)).size;
  const highlights = [...firsts, ...favorites, ...entries].filter((e, i, all) => all.findIndex((x) => x._id === e._id) === i);
  const lines = [`${month} 成长月记`, `记录了 ${days} 天，共 ${entries.length} 条，${images.length} 张照片。`,
    `第一次 ${firsts.length} 条，里程碑收藏 ${favorites.length} 条。`];
  for (const e of highlights.slice(0, 6)) lines.push(`${e.happened_on.slice(5)}：${(e.content || '照片记录').replace(/\s+/g, ' ').slice(0, 40)}`);
  return { count: entries.length, days, firstCount: firsts.length, favoriteCount: favorites.length,
    photoCount: images.length, photos: images.slice(0, 12), highlights: highlights.slice(0, 6), text: lines.join('\n').slice(0, 500) };
}

module.exports = { summarize };
