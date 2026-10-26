const app = getApp();
const { editField } = require('../../utils/cards');

Page({
  data: { loading: true, busy: false, error: '', conflict: false, canEdit: false,
    entryLoaded: false, readOnly: false, sourceWarning: '', card: null, cardsSupported: false, content: '', note: '', date: '', at: '', planned: false, smartSupported: false, kindIndex: 0, kinds: ['日常', '第一次', '健康'], images: [] },

  onLoad(options) {
    this.id = options.id;
    this.expectedRevision = options.revision === undefined ? null : Number(options.revision);
    this.setData({ readOnly: options.readonly === '1' });
    this.load();
  },

  onUnload() { this.loadId = (this.loadId || 0) + 1; },

  async load() {
    if (this.data.busy) return;
    const loadId = this.loadId = (this.loadId || 0) + 1;
    this.setData({ loading: true, error: '', conflict: false, canEdit: false, entryLoaded: false, card: null, sourceWarning: '' });
    try {
      await app.requireRecordTools();
      const caps = await app.getEntryCapabilities();
      const r = await app.entryRequest({ action: 'get', id: this.id });
      if (loadId !== this.loadId) return;
      if (!r.entry || !r.member) throw new Error('记录返回格式错误');
      if (r.entry.deleted_at) throw new Error('记录已删除，请先在回收站恢复');
      this.entry = r.entry;
      this.setData({ entryLoaded: true, card: r.entry.card || null, cardsSupported: caps.dynamicCards === 1,
        sourceWarning: this.expectedRevision !== null && Number.isFinite(this.expectedRevision) && this.expectedRevision !== (r.entry.revision || 0) ? '原记录已更新，当前展示最新内容；请返回刷新统计或重新检查关联。' : '',
        at: r.entry.at || '', planned: r.entry.planned === true, smartSupported: caps.smartInput === 1, content: r.entry.content || '', note: r.entry.note || '', date: r.entry.happened_on,
        images: r.entry.images || [], kindIndex: Math.max(0, ['daily', 'first', 'health'].indexOf(r.entry.kind)),
        canEdit: !this.data.readOnly && ['owner', 'editor'].includes(r.member.role) });
    } catch (err) {
      if (loadId === this.loadId) this.setData({ error: err.message });
    } finally {
      if (loadId === this.loadId) this.setData({ loading: false });
    }
  },

  onContent(e) { if (!this.data.busy && this.data.canEdit) this.setData({ content: e.detail.value, card: null }); },
  onNote(e) { if (!this.data.busy) this.setData({ note: e.detail.value }); },
  onDate(e) { if (!this.data.busy) this.setData({ date: e.detail.value, card: null }); },
  onTime(e) { if (!this.data.busy) this.setData({ at: e.detail.value, card: null }); },
  onPlanned(e) { if (!this.data.busy) this.setData({ planned: e.detail.value }); },
  onKind(e) { if (!this.data.busy) this.setData({ kindIndex: Number(e.detail.value) }); },
  onPreview(e) { wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.images }); },

  onCardField(e) {
    if (!this.data.canEdit || this.data.busy || !this.data.card || !this.data.cardsSupported) return;
    this.setData({ card: editField(this.data.card, e.detail.index, e.detail.value, e.detail.remove) });
  },
  onCardUnlink(e) {
    if (!this.data.canEdit || this.data.busy || !this.data.card || !this.data.cardsSupported) return;
    this.setData({ card: Object.assign({}, this.data.card, { related: this.data.card.related.filter((_, i) => i !== e.detail.index) }) });
  },
  onRemoveCard() { if (this.data.canEdit && !this.data.busy && this.data.cardsSupported) this.setData({ card: null }); },

  reloadLatest() {
    wx.showModal({ title: '重新读取记录？', content: '当前未保存的修改将被替换为最新记录。',
      success: (r) => { if (r.confirm) this.load(); } });
  },

  async onSave() {
    if (this.data.busy || this.data.loading || !this.data.canEdit || this.data.conflict) return;
    if (!this.data.content.trim() && !this.data.images.length) {
      this.setData({ error: '写点什么，或保留原有图片' }); return;
    }
    if (this.data.content.length > 500) { this.setData({ error: '正文超过500字，已保留原文，请缩短后保存' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      await app.entryRequest({ action: 'update', id: this.id, revision: this.entry.revision || 0,
        cards: this.data.cardsSupported ? 1 : undefined, card: this.data.card,
        content: this.data.content, note: this.data.note, happened_on: this.data.date,
        smartInput: this.data.smartSupported ? 1 : undefined, at: this.data.at, planned: this.data.planned,
        kind: ['daily', 'first', 'health'][this.data.kindIndex] });
      wx.showToast({ title: '已保存', icon: 'none' });
      wx.navigateBack();
    } catch (err) {
      this.setData({ error: err.message, conflict: err.code === 'CONFLICT' });
    } finally { this.setData({ busy: false }); }
  },
});
