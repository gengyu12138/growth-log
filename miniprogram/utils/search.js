/**
 * 关键词检索。搬自 web/app.js collectContext()，去掉「命中不足就返回最近 N 条」的兜底。
 * 搜索不是问答，没命中就该返回空。
 */

function tokenize(q) {
  return String(q)
    .replace(/[，。？！、,.?!\s]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function search(entries, query) {
  const words = tokenize(query);
  if (!words.length) return [];

  const scored = [];
  for (const e of entries) {
    // 正文、标签、地点、备注都参与匹配：
    // 体温这类记录正文可能只写「39度」，而「发烧」是模型补的标签
    const haystack = [
      e.content || '',
      (e.tags || []).join(' '),
      e.place || '',
      e.note || '',
      e.card ? e.card.type + ' ' + (e.card.fields || []).map((field) => field.label + ' ' + field.value + field.unit).join(' ') : '',
    ].join(' ');

    let score = 0;
    for (const w of words) {
      if (haystack.indexOf(w) >= 0) score += 1;
    }
    if (score > 0) scored.push({ e, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.e.happened_on < b.e.happened_on ? 1 : -1;
  });

  return scored.map((s) => s.e);
}

/** 把命中词包上标记，供 wxml 拆成多段渲染 */
function highlight(text, query) {
  const words = tokenize(query);
  if (!words.length) return [{ t: text, hit: false }];

  const marks = new Array(text.length).fill(false);
  for (const w of words) {
    let from = 0;
    while (true) {
      const idx = text.indexOf(w, from);
      if (idx < 0) break;
      for (let i = idx; i < idx + w.length; i += 1) marks[i] = true;
      from = idx + w.length;
    }
  }

  const parts = [];
  let buf = '';
  let cur = marks[0] || false;
  for (let i = 0; i < text.length; i += 1) {
    const m = marks[i];
    if (m === cur) {
      buf += text[i];
    } else {
      if (buf) parts.push({ t: buf, hit: cur });
      buf = text[i];
      cur = m;
    }
  }
  if (buf) parts.push({ t: buf, hit: cur });
  return parts;
}

module.exports = { tokenize, search, highlight };
