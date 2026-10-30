const app = getApp();
const dates = require('../../utils/date');
const { summarize } = require('../../utils/growth');
const { statistics } = require('../../utils/cards');

Page({
  data: { tab: 'memories', loading: false, refreshing: false, viewReady: false, error: '', groups: [], milestones: [],
    statStart: '', statEnd: '', statistics: null, sourceTitle: '', sources: [], sourceTotal: 0, month: '', summary: null, note: '', noteStatus: '', canEdit: false },
  onLoad() {
    const today = new Date(), start = new Date(today); start.setDate(start.getDate() - 6);
    this.setData({ month: dates.fmtDate(today).slice(0, 7), statStart: dates.fmtDate(start), statEnd: dates.fmtDate(today) });
  },
  onShow() { app.selectTab(this, 'growth'); this.load(); },
  onHide() { this.rememberView(); },
  onUnload() { this.loadId = (this.loadId || 0) + 1; },
  onTab(e) {
    if (e.currentTarget.dataset.tab === this.data.tab) return;
    this.rememberView(); this.setData({ tab: e.currentTarget.dataset.tab }); this.load();
  },
  onMonth(e) { this.setData({ month: e.detail.value }); this.load(); },

  viewKey() {
    return this.data.tab + ':' + (this.data.tab === 'summary' ? this.data.month
      : this.data.tab === 'statistics' ? this.data.statStart + ':' + this.data.statEnd : dates.fmtDate(new Date()));
  },
  rememberView() {
    if (!this.data.viewReady || this.loadedKey !== this.viewKey() || this.data.error) return;
    const data = {};
    for (const key of ['groups', 'milestones', 'statistics', 'summary', 'note', 'noteStatus', 'canEdit']) data[key] = this.data[key];
    if (!this.viewCache) this.viewCache = {};
    this.viewCache[this.data.tab] = { key: this.loadedKey, data, stats: this.data.tab === 'statistics' ? this.stats : null };
  },

  async load() {
    const id = this.loadId = (this.loadId || 0) + 1;
    const month = this.data.month, tab = this.data.tab;
    const key = this.viewKey(), cached = this.viewCache && this.viewCache[tab];
    if (cached && cached.key === key && this.loadedKey !== key) {
      this.stats = cached.stats; this.loadedKey = key;
      this.setData(Object.assign({}, cached.data, { viewReady: true }));
    }
    const background = this.data.viewReady && this.loadedKey === key;
    const patch = { sources: [], sourceTitle: '', sourceTotal: 0, error: '', loading: !background, refreshing: background };
    if (!background) Object.assign(patch, { statistics: null, groups: [], milestones: [], summary: null, note: '', noteStatus: '', viewReady: false });
    this.setData(patch);
    try {
      const member = await app.ensureMember();
      if (!member) throw new Error('请先加入家庭');
      await app.requireRecordTools();
      if (id !== this.loadId) return;
      if (this.member && (this.member._id !== member._id || this.member.family_code !== member.family_code)) {
        this.viewCache = {}; this.loadedKey = null; this.stats = null;
        this.setData({ statistics: null, groups: [], milestones: [], summary: null, note: '', noteStatus: '', viewReady: false, canEdit: false, loading: true, refreshing: false });
      }
      this.member = member;
      const cancelled = () => id !== this.loadId;
      if (tab === 'statistics') {
        const start = this.data.statStart, end = this.data.statEnd;
        if (!dates.validDate(start) || !dates.validDate(end) || start > end
          || Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z') > 365 * 86400000) {
          throw new Error('请选择有效日期范围，最多366天');
        }
        const rows = [];
        let monthKey = start.slice(0, 7);
        while (monthKey <= end.slice(0, 7)) {
          rows.push(...await app.collectEntries({ month: monthKey }, member.family_code, cancelled));
          if (cancelled()) return;
          if (rows.length > 10000) throw new Error('记录较多，请缩小统计日期范围');
          const parts = monthKey.split('-').map(Number);
          monthKey = parts[1] === 12 ? (parts[0] + 1) + '-01' : parts[0] + '-' + dates.pad(parts[1] + 1);
        }
        this.stats = statistics(rows, start, end);
        // 原文只在点开依据时传给视图，避免为每个指标重复传输完整正文。
        this.setData({ statistics: Object.assign({}, this.stats, { groups: this.stats.groups.map((group) => ({
          type: group.type, count: group.count, metrics: group.metrics.map((metric) => ({ label: metric.label, unit: metric.unit,
            additive: metric.additive, count: metric.count, total: metric.total, average: metric.average,
            min: metric.min, max: metric.max, latest: metric.latest, previous: metric.sources.length > 1 ? metric.sources[1].value : null, latestDate: metric.sources[0].date, points: metric.sources.slice(0, 6).map((source) => ({ date: source.date, value: source.value })) })) })) }) });
      } else if (tab === 'summary') {
        const rows = await app.collectEntries({ month }, member.family_code, cancelled);
        if (cancelled()) return;
        const summary = summarize(rows, month);
        this.noteKey = 'monthNote:' + member._id + ':' + member.family_code + ':' + month;
        const saved = wx.getStorageSync(this.noteKey);
        const hasDraft = saved && typeof saved.text === 'string';
        this.setData({ summary, note: hasDraft ? saved.text : summary.text,
          noteStatus: hasDraft ? '已恢复本机月记草稿' : '已根据本月记录整理，可编辑后带到首页',
          canEdit: ['owner', 'editor'].includes(member.role) });
      } else {
        const today = dates.fmtDate(new Date());
        const targets = [{ label: '一个月前', date: dates.shiftDateMonths(today, -1) },
          { label: '一年前', date: dates.shiftDateMonths(today, -12) }];
        const groups = [];
        for (const target of targets) {
          const rows = await app.collectEntries({ month: target.date.slice(0, 7) }, member.family_code, cancelled);
          const exact = rows.filter((e) => !e.planned && e.happened_on === target.date);
          const entries = exact.length ? exact : rows.filter((e) => !e.planned && e.happened_on < today).slice(0, 3);
          if (entries.length) groups.push({ label: exact.length ? target.label : target.label === '一个月前' ? '上个月的回忆' : '去年这个月的回忆', date: entries[0].happened_on, entries });
        }
        const [favorites, recent] = await Promise.all([
          app.entryRequest({ action: 'list', scope: 'favorites' }), app.entryRequest({ action: 'list' }),
        ]);
        if (cancelled()) return;
        if ([favorites, recent].some((r) => !Array.isArray(r.list) || !r.member || r.member.family_code !== member.family_code)) throw new Error('家庭记录返回异常');
        const seen = new Set();
        const milestones = favorites.list.concat(recent.list.filter((e) => e.kind === 'first')).filter((e) => {
          if (seen.has(e._id) || e.planned || e.happened_on > today) return false;
          seen.add(e._id); return true;
        }).sort((a,b) => b.happened_on.localeCompare(a.happened_on));
        if (!groups.length) {
          const entries = recent.list.filter((e) => !e.planned && e.happened_on < today).slice(0, 3);
          if (entries.length) groups.push({ label: '再看看最近留下的片段', date: entries[0].happened_on, entries });
        }
        this.setData({ groups, milestones: milestones.slice(0, 8) });
      }
      if (cancelled()) return;
      this.loadedKey = key; this.setData({ viewReady: true }); this.rememberView();
    } catch (err) {
      if (id === this.loadId) this.setData({ error: err.message || '读取失败，请重试' });
    } finally { if (id === this.loadId) this.setData({ loading: false, refreshing: false }); }
  },

  onStatDate(e) {
    const field = e.currentTarget.dataset.field;
    if (!['statStart', 'statEnd'].includes(field)) return;
    this.setData({ [field]: e.detail.value }); this.load();
  },
  onStatWindow(e) {
    const today = new Date(), start = new Date(today), window = e.currentTarget.dataset.window;
    if (window === 'week') start.setDate(start.getDate() - 6);
    else if (window === 'month') start.setDate(1);
    this.setData({ statStart: dates.fmtDate(start), statEnd: dates.fmtDate(today) }); this.load();
  },
  showSources(e) {
    if (this.data.loading || this.data.error || !this.stats) return;
    const group = this.stats.groups[Number(e.currentTarget.dataset.group)];
    if (!group) return;
    const index = e.currentTarget.dataset.metric;
    const metric = index === undefined ? null : group.metrics[Number(index)];
    this.statisticSources = metric ? metric.sources : group.sources;
    const title = group.type + (metric ? ' · ' + metric.label + '（' + metric.unit + '）' : ' · 记录条数');
    this.setData({ sourceTitle: title, sources: this.statisticSources.slice(0, 30), sourceTotal: this.statisticSources.length });
  },
  moreSources() { this.setData({ sources: this.statisticSources.slice(0, this.data.sources.length + 30) }); },
  closeSources() { this.setData({ sourceTitle: '', sources: [], sourceTotal: 0 }); this.statisticSources = []; },
  openSource(e) {
    const item = this.data.sources[Number(e.currentTarget.dataset.index)];
    if (item) wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(item.id) + '&revision=' + item.revision });
  },

  onNote(e) {
    if (this.data.loading || !this.data.summary || !this.data.canEdit) return;
    this.setData({ note: e.detail.value });
    try {
      wx.setStorageSync(this.noteKey, { text: e.detail.value });
      this.setData({ noteStatus: '月记草稿已保存在本机' });
    } catch (err) { this.setData({ noteStatus: '月记草稿保存失败，请勿退出页面' }); }
  },

  toDraft() {
    if (this.data.loading || !this.data.canEdit || !this.data.summary || !this.data.summary.count || !this.data.note.trim()) return;
    const key = 'entryDraft:' + this.member._id + ':' + this.member.family_code;
    const old = wx.getStorageSync(key), pending = wx.getStorageSync('pendingEntry:' + this.member._id);
    if (pending || old && (old.text || old.images && old.images.length)) {
      wx.showToast({ title: '首页已有草稿，请先处理后再带入月记', icon: 'none' }); return;
    }
    const today = dates.fmtDate(new Date());
    const end = dates.fmtDate(new Date(Number(this.data.month.slice(0, 4)), Number(this.data.month.slice(5)), 0));
    const date = end > today ? today : end;
    try {
      wx.setStorageSync(key, { text: this.data.note, kind: 'daily', images: [], date, baseDate: date, dateManual: true,
        proposals: [{ content: this.data.note, date, at: '', planned: false, card: null }], newTypes: [], knownTypes: [] });
      wx.reLaunch({ url: '/pages/index/index?date=' + date });
    } catch (err) { this.setData({ error: '草稿保存失败，请重试' }); }
  },
  onOpen(e) { wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  goPhotos() { wx.navigateTo({ url: '/pages/photos/photos' }); },
  goFirsts() { wx.navigateTo({ url: '/pages/search/search?kind=first' }); },
  reviewMonth() {
    app.openAssistant('整理' + this.data.month + '的成长故事，回顾重要变化并引用原文');
  },
  goFavorites() { wx.navigateTo({ url: '/pages/library/library' }); },
  goMonth() { wx.navigateTo({ url: '/pages/search/search?month=' + this.data.month }); },
  onPreview(e) { wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.summary.photos }); },
});
