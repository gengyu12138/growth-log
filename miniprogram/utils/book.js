const { entryTime, recordedTimeLabel } = require('./date');
const escape = (value) => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function growthBook(rows, title, files = []) {
  const paths = new Map(files.map((f) => [f.fileID, f.path]));
  const sorted = rows.slice().sort((a, b) => (a.happened_on + (a.at || '')).localeCompare(b.happened_on + (b.at || '')));
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title)
    + '</title><style>body{max-width:760px;margin:40px auto;padding:0 24px;color:#243c32;background:#f6faf7;font:17px/1.8 system-ui,sans-serif}article{margin:28px 0;padding:24px;background:#fff;border:1px solid #dce7df;border-radius:16px;break-inside:avoid}h1{font-size:30px}h2{font-size:19px}p{white-space:pre-wrap}small{color:#52695e}img{max-width:100%;height:auto;margin-top:14px;border-radius:10px}@media print{body{background:#fff;margin:0}article{border:0;padding:10px 0}}</style><h1>' + escape(title)
    + '</h1><small>按事件日期排列 · ' + rows.length + ' 条记录 · 缺少事件时刻时显示首次保存时间</small>'
    + sorted.map((row) => '<article><h2>' + escape(row.happened_on) + ' ' + escape(entryTime(row) || '时间待核对') + (!row.at ? ' · 记录时间' : '') + (row.planned ? ' · 计划' : '')
      + '</h2><p>' + escape(row.content || '照片记录') + '</p>' + (row.note ? '<p>' + escape(row.note) + '</p>' : '')
      + (row.images || []).filter((id) => paths.has(id)).map((id) => '<img alt="这条记录的照片" src="' + escape(paths.get(id)) + '">').join('')
      + '<small>' + escape(row.author || '家人') + (!row.at ? ' · ' + escape(recordedTimeLabel(row.created_at)) : '') + '</small></article>').join('') + '</html>';
}
module.exports = { growthBook };
