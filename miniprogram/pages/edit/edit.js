const app = getApp();
const { editField, clearInterval } = require('../../utils/cards');
const dates = require('../../utils/date');
const FORM_FIELDS = ['content', 'note', 'date', 'at', 'planned', 'kindIndex', 'images', 'card', 'reanalyzed'];

Page({
  data: { loading: true, busy: false, analyzing: false, pending: false, dirty: false, error: '', conflict: false, canEdit: false,
    entryLoaded: false, readOnly: false, mayEdit: false, sourceWarning: '', card: null, cardsSupported: false,
    content: '', note: '', date: '', at: '', planned: false, smartSupported: false, kindIndex: 0, staleDraft: null,
    kinds: ['日常', '第一次', '健康'], images: [], photosSupported: false, reanalyzed: false, analysisStatus: '', readingEntry: null, fallbackTime: '' },
  onLoad(options) {
    this.id = options.id;
    this.expectedRevision = options.revision === undefined ? null : Number(options.revision);
    this.setData({ readOnly: options.readonly === '1' }); this.load();
  },
  onHide() { this.persist(); },
  onUnload() { this.disposed = true; this.loadId = (this.loadId || 0) + 1; this.persist(); },
  async load() {
    if (this.data.busy) return;
    const loadId = this.loadId = (this.loadId || 0) + 1;
    this.setData({ loading: true, error: '', conflict: false, canEdit: false, entryLoaded: false, card: null, sourceWarning: '' });
    try {
      await app.requireRecordTools();
      this.caps = await app.getEntryCapabilities();
      const r = await app.entryRequest({ action: 'get', id: this.id });
      if (loadId !== this.loadId) return;
      if (!r.entry || !r.member) throw new Error('记录返回格式错误');
      if (r.entry.deleted_at) throw new Error('记录已删除，请先在回收站恢复');
      this.entry = r.entry; this.member = r.member;
      this.draftKey = 'editDraft:' + r.member._id + ':' + r.member.family_code + ':' + this.id;
      this.setData({ entryLoaded: true, readingEntry: r.entry, card: r.entry.card || null, cardsSupported: this.caps.dynamicCards === 1,
        sourceWarning: this.expectedRevision !== null && this.expectedRevision !== (r.entry.revision || 0) ? '原记录已更新，当前展示最新内容，请返回刷新统计或关联。' : '',
        at: r.entry.at || '', fallbackTime: dates.entryTime(r.entry), planned: r.entry.planned === true, smartSupported: this.caps.smartInput === 1,
        content: r.entry.content || '', note: r.entry.note || '', date: r.entry.happened_on,
        images: r.entry.images || [], photosSupported: this.caps.entryPhotos === 1,
        kindIndex: Math.max(0, ['daily', 'first', 'health'].indexOf(r.entry.kind)),
        mayEdit: ['owner', 'editor'].includes(r.member.role),
        canEdit: !this.data.readOnly && ['owner', 'editor'].includes(r.member.role), dirty: false, pending: false });
      if (!this.data.readOnly) this.restoreDraft();
    } catch (err) { if (loadId === this.loadId) this.setData({ error: err.message }); }
    finally { if (loadId === this.loadId) this.setData({ loading: false }); }
  },
  beginEdit() { this.setData({ readOnly: false, canEdit: this.data.mayEdit }); this.restoreDraft(); },
  restoreDraft() {
    try {
      const saved = wx.getStorageSync(this.draftKey);
      if (!saved) return;
      const f = saved.form;
      if (!f || typeof f.content !== 'string' || typeof f.note !== 'string' || !dates.validDate(f.date)
        || typeof f.at !== 'string' || f.at !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.at)
        || typeof f.planned !== 'boolean' || ![0, 1, 2].includes(f.kindIndex) || typeof f.reanalyzed !== 'boolean'
        || !Array.isArray(f.images) || f.images.length > 9 || f.images.some((image) => typeof image !== 'string')) throw new Error('编辑草稿格式异常，请勿覆盖');
      if (saved.pendingSubmit && (saved.pendingSubmit.id !== this.id || !['update', 'assistantApply'].includes(saved.pendingSubmit.action))) throw new Error('待确认修改与当前记录不符');
      if (saved.revision !== (this.entry.revision || 0) && !saved.pendingSubmit) {
        this.setData({ staleDraft: f, sourceWarning: '本机草稿对应旧版本。请对照当前记录，选择载入草稿或保留最新记录。' }); return;
      }
      this.pendingSubmit = saved.pendingSubmit || null;
      this.approvedTypes = saved.approvedTypes || [];
      const form = Object.fromEntries(FORM_FIELDS.map((key) => [key, f[key]]));
      this.setData(Object.assign(form, { dirty: true, pending: !!this.pendingSubmit, analysisStatus: '已恢复本机编辑草稿，请检查后保存' }));
    } catch (err) { this.setData({ error: err.message || '编辑草稿读取失败' }); }
  },
  useStaleDraft() {
    if (!this.data.staleDraft) return;
    const form = Object.fromEntries(FORM_FIELDS.map((key) => [key, this.data.staleDraft[key]]));
    this.setData(Object.assign(form, { staleDraft: null, dirty: true, card: null, reanalyzed: false, sourceWarning: '已载入旧草稿，请对照最新记录并重新整理卡片，确认后再保存' })); this.persist();
  },
  discardStaleDraft() {
    wx.showModal({ title: '保留云端最新记录？', content: '这会丢弃本机旧编辑草稿，云端记录不变。', success: (r) => {
      if (r.confirm) { wx.removeStorageSync(this.draftKey); this.setData({ staleDraft: null, sourceWarning: '' }); }
    } });
  },
  form() {
    const d = this.data;
    return { content: d.content, note: d.note, date: d.date, at: d.at, planned: d.planned,
      kindIndex: d.kindIndex, images: d.images, card: d.card, reanalyzed: d.reanalyzed };
  },
  persist() {
    if (!this.draftKey || !this.data.dirty || this.data.readOnly || !this.entry) return;
    try { wx.setStorageSync(this.draftKey, { revision: this.entry.revision || 0, form: this.form(), pendingSubmit: this.pendingSubmit || null, approvedTypes: this.approvedTypes || [] }); }
    catch (err) { if (!this.disposed) this.setData({ error: '编辑草稿未能保存在本机，请勿退出页面' }); }
  },
  change(patch, invalidate) {
    if (!this.data.canEdit || this.data.busy || this.data.analyzing || this.data.pending || this.data.staleDraft) return;
    this.setData(Object.assign({}, patch, { dirty: true }, invalidate ? { card: null, reanalyzed: false, analysisStatus: '正文或时间已变化，可重新整理卡片' } : {}));
    this.persist();
  },
  onContent(e) { this.change({ content: e.detail.value }, true); },
  onNote(e) { this.change({ note: e.detail.value }); },
  onDate(e) { this.change({ date: e.detail.value }, true); },
  onTime(e) { this.change({ at: e.detail.value }, true); },
  onPlanned(e) { this.change({ planned: e.detail.value }); },
  onKind(e) { this.change({ kindIndex: Number(e.detail.value) }); },
  onPreview(e) { wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.images }); },
  onCardField(e) { if (this.data.card) this.change({ card: editField(this.data.card, e.detail.index, e.detail.value, e.detail.remove) }); },
  onCardUnlink(e) { if (this.data.card) this.change({ card: Object.assign({}, this.data.card, { related: this.data.card.related.filter((_, i) => i !== e.detail.index) }) }); },
  onRemoveCard() { this.change({ card: null, reanalyzed: false }); },
  async reanalyze() {
    if (!this.data.canEdit || this.data.busy || this.data.analyzing || this.data.pending || this.data.staleDraft) return;
    if (!this.data.content.trim() || this.data.content.length > 500) { this.setData({ error: '请填写500字以内的正文' }); return; }
    this.setData({ analyzing: true, error: '', analysisStatus: '正在根据当前原文整理卡片…' });
    try {
      const r = await app.entryRequest({ action: 'analyze', content: this.data.content.trim(), selectedDate: this.data.date, cards: 1, excludeId: this.id });
      if (this.disposed) return;
      if (!Array.isArray(r.events) || r.events.length !== 1 || r.events[0].content !== this.data.content.trim()) throw new Error('这段文字包含多件事或识别未完整保留原文，请检查后以原文保存，或在首页分别记录');
      const event = r.events[0];
      const card = event.date && event.date !== this.data.date || event.at && event.at !== this.data.at ? clearInterval(event.card) : event.card;
      this.approvedTypes = r.newTypes || [];
      this.setData({ card: card || null, reanalyzed: true, dirty: true,
        analysisStatus: (r.warning ? r.warning + '；' : '') + '卡片已重新整理，保留手选日期和时间，检查后再保存' });
      this.persist();
    } catch (err) { if (!this.disposed) this.setData({ error: err.message, analysisStatus: '未改变已保存记录' }); }
    finally { if (!this.disposed) this.setData({ analyzing: false }); }
  },
  async addPhotos() {
    if (!this.data.canEdit || this.data.busy || this.data.pending || this.data.analyzing || this.data.staleDraft) return;
    if (!this.data.photosSupported) { this.setData({ error: '补照片需要同步新版云函数，原有记录仍可查看和编辑' }); return; }
    if (this.data.images.length >= 9) return;
    this.setData({ busy: true });
    try {
      const result = await wx.chooseMedia({ count: 9 - this.data.images.length, mediaType: ['image'], sizeType: ['compressed'] });
      for (const file of result.tempFiles) {
        const saved = await new Promise((resolve, reject) => wx.saveFile({ tempFilePath: file.tempFilePath, success: resolve, fail: reject }));
        this.setData({ images: this.data.images.concat(saved.savedFilePath), dirty: true }); this.persist();
      }
    } catch (err) { if (!String(err.errMsg || '').includes('cancel')) this.setData({ error: '照片未全部加入，请重试' }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  removePhoto(e) { this.change({ images: this.data.images.filter((_, i) => i !== Number(e.currentTarget.dataset.index)) }); },
  reloadLatest() {
    wx.showModal({ title: '重新读取记录？', content: '本页未保存的修改会被最新记录替换，请先复制需要保留的内容。', success: (r) => {
      if (r.confirm) { this.pendingSubmit = null; wx.removeStorageSync(this.draftKey); this.load(); }
    } });
  },
  async onSave() {
    if (this.data.busy || this.data.analyzing || this.data.loading || !this.data.canEdit || this.data.conflict || this.data.staleDraft) return;
    if (!this.data.content.trim() && !this.data.images.length || this.data.content.length > 500) { this.setData({ error: '请保留正文或照片，正文最多500字' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      if (!this.pendingSubmit) {
        if (this.data.reanalyzed && this.caps.editRebuild !== 1) throw new Error('卡片重新整理已完成，保存此卡片需要先同步新版云函数');
        const confirmed = await new Promise((resolve) => wx.showModal({ title: '确认保存修改？',
          content: '修改前：' + (this.entry.content || '照片记录') + '\n修改后：' + (this.data.content || '照片记录')
            + '\n发生日期：' + this.data.date + ' ' + (this.data.at || (this.data.fallbackTime ? this.data.fallbackTime + '（记录时间）' : '时间待核对'))
            + '\n照片：' + (this.entry.images || []).length + ' → ' + this.data.images.length + ' 张'
            + (this.approvedTypes && this.approvedTypes.length ? '\n确认新类型：' + this.approvedTypes.join('、') : '')
            + '\n卡片以页面预览为准，确认后才修改原记录。', confirmText: '确认保存', cancelText: '返回检查', success: (r) => resolve(r.confirm), fail: () => resolve(false) }));
        if (!confirmed || this.disposed) return;
        for (let i = 0; i < this.data.images.length; i += 1) {
          if ((this.entry.images || []).includes(this.data.images[i]) || this.data.images[i].startsWith('cloud://')) continue;
          const uploaded = await wx.cloud.uploadFile({ cloudPath: 'entries/' + this.member.family_code + '/' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2) + '.jpg', filePath: this.data.images[i] });
          const images = this.data.images.slice(); images[i] = uploaded.fileID; this.setData({ images }); this.persist();
        }
        this.pendingSubmit = { action: this.data.reanalyzed ? 'assistantApply' : 'update', confirmed: true, id: this.id,
          revision: this.entry.revision || 0, content: this.data.content, note: this.data.note, happened_on: this.data.date,
          cards: this.data.cardsSupported ? 1 : undefined, card: this.data.card, smartInput: this.data.smartSupported ? 1 : undefined,
          at: this.data.at, planned: this.data.planned, kind: ['daily', 'first', 'health'][this.data.kindIndex], approvedTypes: this.approvedTypes || [] };
        if (this.caps.entryPhotos === 1) this.pendingSubmit.images = this.data.images.slice();
        this.setData({ pending: true }); this.persist();
      }
      await app.entryRequest(this.pendingSubmit);
      this.pendingSubmit = null; this.setData({ dirty: false, pending: false }); wx.removeStorageSync(this.draftKey);
      wx.showToast({ title: '已保存', icon: 'none' }); wx.navigateBack();
    } catch (err) {
      if (err.definite) { this.pendingSubmit = null; this.setData({ pending: false }); }
      if (!this.disposed) { this.setData({ error: err.message, conflict: err.code === 'CONFLICT' }); this.persist(); }
    } finally { if (!this.disposed) this.setData({ busy: false }); }
  },
});
