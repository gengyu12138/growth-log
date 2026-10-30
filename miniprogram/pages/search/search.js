const { search, highlight } = require('../../utils/search');
const dateUtil = require('../../utils/date');

const app = getApp();
const KIND_LABEL = { daily: '日常', first: '第一次', health: '健康' };

Page({
  data: {
    q: '',
    results: [],
    searched: false,
    loading: true,
    loadError: '',
    hasMore: false,
    loadedCount: 0,
    month: '',
    kindIndex: 0,
    imageIndex: 0,
    favoriteOnly: false,
    kinds: ['全部分类', '日常', '第一次', '健康'],
    imageOptions: ['不限图片', '有图片', '无图片'],
  },

  onLoad(options) {
    this.all = [];

    // 标签跳过来时带的是编码过的中文，必须解码，否则搜不到
    let q = (options && options.q) || '';
    try {
      q = decodeURIComponent(q);
    } catch (e) {
      // 已经是明文就原样用
    }

    if (q) this.setData({ q });
    if (options && options.kind === 'first') this.setData({ kindIndex: 2 });
    if (options && /^\d{4}-(0[1-9]|1[0-2])$/.test(options.month || '')) this.setData({ month: options.month });
    this.init();
  },

  async init(append = false) {
    if (append && (this.data.loading || !this.cursor)) return;
    const id = this.loadId = (this.loadId || 0) + 1;
    if (!append) {
      this.all = [];
      this.cursor = null;
      this.setData({ results: [], searched: false, loadedCount: 0, hasMore: false });
    }
    this.setData({ loading: true, loadError: '' });
    try {
      const member = await app.ensureMember();
      if (id !== this.loadId) return;
      if (!member) {
        wx.reLaunch({ url: '/pages/join/join' });
        return;
      }
      const query = { action: 'list', cursor: this.cursor };
      if (this.data.month) query.month = this.data.month;
      const result = await app.listEntries(query);
      if (id !== this.loadId) return;
      const r = result || {};
      if (!r.ok) {
        if (r.error && r.error.indexOf('加入家庭') >= 0) {
          app.clearMember();
          wx.reLaunch({ url: '/pages/join/join' });
          return;
        }
        throw new Error(r.error || '加载失败');
      }
      if (!Array.isArray(r.list) || !Object.prototype.hasOwnProperty.call(r, 'nextCursor')) {
        throw new Error('记录返回格式错误');
      }
      if (r.nextCursor && JSON.stringify(r.nextCursor) === JSON.stringify(this.cursor)) {
        throw new Error('翻页位置没有更新');
      }
      const existing = new Set(this.all.map((e) => e._id));
      this.all = this.all.concat(r.list.filter((e) => !existing.has(e._id)).map((e) => Object.assign({}, e, {
        images: e.images || [],
        kindLabel: KIND_LABEL[e.kind] || '日常',
      })));
      this.cursor = r.nextCursor;
      this.setData({ hasMore: Boolean(this.cursor), loadedCount: this.all.length });
    } catch (err) {
      if (id !== this.loadId) return;
      this.setData({ loading: false, loadError: '记录加载失败，请重试' });
      return;
    }

    this.setData({ loading: false });
    this.run(this.data.q);
  },

  onLoadMore() {
    return this.init(true);
  },

  onRetry() {
    return this.init(Boolean(this.cursor));
  },

  onUnload() {
    clearTimeout(this.timer);
    this.loadId = (this.loadId || 0) + 1;
  },

  onInput(e) {
    const q = e.detail.value;
    this.setData({ q });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(q), 220);
  },

  onConfirm() {
    this.run(this.data.q);
  },
  clearQuery() { clearTimeout(this.timer); this.setData({ q: '' }); this.run(''); },

  onMonth(e) { this.setData({ month: e.detail.value }); this.init(); },
  clearMonth() { this.setData({ month: '' }); this.init(); },
  onKind(e) { this.setData({ kindIndex: Number(e.detail.value) }); this.run(this.data.q); },
  onImages(e) { this.setData({ imageIndex: Number(e.detail.value) }); this.run(this.data.q); },
  onFavorite(e) { this.setData({ favoriteOnly: e.detail.value }); this.run(this.data.q); },

  run(raw) {
    const q = String(raw || '').trim();
    const filtered = Boolean(this.data.month || this.data.kindIndex || this.data.imageIndex || this.data.favoriteOnly);
    if (!q && !filtered) {
      this.setData({ results: [], searched: false });
      return;
    }

    // 加载成功后统一使用输入框的最新内容，失败不能当成空结果。
    if (this.data.loading || this.data.loadError) return;

    const selected = this.all.filter((e) => (!this.data.month || e.happened_on.slice(0, 7) === this.data.month)
      && (!this.data.kindIndex || e.kind === ['','daily','first','health'][this.data.kindIndex])
      && (!this.data.imageIndex || (this.data.imageIndex === 1 ? e.images.length > 0 : !e.images.length))
      && (!this.data.favoriteOnly || e.favorite === true));
    const hits = (q ? search(selected, q) : selected).map((e) => Object.assign({}, e, {
      parts: highlight(e.content || '', q),
      head: dateUtil.fmtDayHead(e.happened_on),
    }));

    this.setData({ results: hits, searched: true });
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(id) });
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    });
  },
});
