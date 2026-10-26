function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(s) {
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function fmtDayHead(s) {
  const d = parseDate(s);
  const today = fmtDate(new Date());
  const label = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
  return s === today ? `今天 · ${label}` : label;
}

function monthTitle(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/**
 * 返回当月网格，周一开头，固定 6 行 42 格。
 * 非本月位置返回 null。
 */
function buildCalendar(base) {
  const first = startOfMonth(base);
  const year = first.getFullYear();
  const month = first.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // getDay: 0=周日。转成周一=0 的偏移
  const offset = (first.getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const dayNum = i - offset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push(null);
    } else {
      cells.push({
        day: dayNum,
        date: `${year}-${pad(month + 1)}-${pad(dayNum)}`,
      });
    }
  }
  return cells;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function recordedTimeLabel(ts) {
  if (!Number.isFinite(ts) || !Number.isFinite(new Date(ts).getTime())) return '未记录具体时刻';
  return `记录于 ${fmtDate(new Date(ts))} ${fmtTime(ts)}`;
}

function daysBetween(a, b) {
  const ms = parseDate(b).getTime() - parseDate(a).getTime();
  return Math.round(ms / 86400000);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function shiftDateMonths(value, count) {
  if (!validDate(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

function ageLabel(birthday, at) {
  if (!validDate(birthday) || !validDate(at)) return '';
  if (at < birthday) return '出生前';
  if (at === birthday) return '出生当天';
  const b = birthday.split('-').map(Number), a = at.split('-').map(Number);
  let months = (a[0] - b[0]) * 12 + a[1] - b[1];
  // 月末生日按目标月最后一天满月；仅用 UTC 日期，避免夏令时产生小数天。
  if (shiftDateMonths(birthday, months) > at) months -= 1;
  const anchor = shiftDateMonths(birthday, months);
  const days = Math.round((Date.parse(at + 'T00:00:00Z') - Date.parse(anchor + 'T00:00:00Z')) / 86400000);
  const years = Math.floor(months / 12), remainder = months % 12;
  return (years ? years + '岁' : '') + (remainder ? remainder + '个月' : '') + (days ? days + '天' : '');
}

module.exports = {
  pad,
  fmtDate,
  parseDate,
  startOfMonth,
  addMonths,
  fmtDayHead,
  fmtTime,
  recordedTimeLabel,
  monthTitle,
  buildCalendar,
  daysBetween,
  validDate,
  shiftDateMonths,
  ageLabel,
};
