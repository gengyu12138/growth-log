const app = getApp();
const outbox = require('../../utils/outbox');
const dates = require('../../utils/date');
Page({
  data: { originals: [], content: '', note: '', date: '', at: '', kinds: ['日常', '第一次', '健康'], kindIndex: 0,
    planned: false, favorite: false, photoChoices: [], imageCount: 0, card: null, cardStatus: '',
    loading: true, busy: false, analyzing: false, pending: false, canEdit: false, supported: false, canReset: false, error: '' },
  onLoad(options) { this.ids = [options.id, options.other]; this.load(); },
  onUnload() { this.closed = true; this.analysisVersion = (this.analysisVersion || 0) + 1; },
  async load() {
    if (this.data.busy) return;
    this.setData({ loading: true, error: '', canEdit: false });
    try {
      if (!this.ids.every((id) => /^[a-zA-Z0-9_-]{1,80}$/.test(id || '')) || this.ids[0] === this.ids[1]) throw new Error('请选择两条不同的原记录');
      const member = await app.ensureMember(); if (!member) throw new Error('请先加入家庭'); this.member = member;
      this.key = 'mergePending:' + member._id + ':' + member.family_code + ':' + this.ids.join(':');
      const pending = wx.getStorageSync(this.key);
      if (pending) {
        if (pending.id !== this.ids[0] || pending.otherId !== this.ids[1] || pending.memberId !== member._id || pending.familyCode !== member.family_code) throw new Error('本机合并提案身份异常，请保留数据后联系管理员');
        this.payload = pending; this.setData({ pending: true, canReset: pending.failureCode === 'CONFLICT' });
      }
      const caps = await app.getEntryCapabilities();
      const originals = [];
      for (const id of this.ids) {
        const r = await app.entryRequest({ action: 'get', id });
        if (!r.entry || !r.member || r.member.family_code !== member.family_code) throw new Error('原记录读取异常');
        originals.push(r.entry);
      }
      if (this.closed) return;
      if (!pending && originals.some((row) => row.deleted_at)) throw new Error('原记录已进入回收站，请先核对或恢复后再合并');
      this.originals = originals;
      const photos = [...new Set(originals.flatMap((row) => row.images || []))];
      const value = pending || wx.getStorageSync(this.key + ':draft') || { content: originals[0].content === originals[1].content ? originals[0].content : originals.map((row) => row.content).filter(Boolean).join('\n'),
        note: [...new Set(originals.map((row) => row.note).filter(Boolean))].join('\n'), happened_on: originals[0].happened_on,
        at: originals[0].at || '', kind: originals[0].kind, planned: originals[0].planned === true,
        favorite: originals.some((row) => row.favorite), images: photos.length <= 9 ? photos : [], card: null };
      this.images = value.images.slice();
      this.photosConfirmed = photos.length <= 9 || !!pending;
      this.setData({ originals, content: value.content, note: value.note, date: value.happened_on, at: value.at,
        kindIndex: ['daily', 'first', 'health'].indexOf(value.kind), planned: value.planned, favorite: value.favorite, card: value.card,
        photoChoices: photos.map((id) => ({ id, checked: this.images.includes(id) })), imageCount: this.images.length,
        canEdit: ['owner', 'editor'].includes(member.role), supported: caps.mergeEntries === 1,
        cardStatus: photos.length > 9 && !pending ? '照片超过9张，请明确选择要保留的照片；未自动截取' : '默认保留原文，不沿用可能重复统计的旧卡片' });
    } catch (err) { if (!this.closed) this.setData({ error: err.message }); }
    finally { if (!this.closed) this.setData({ loading: false }); }
  },
  onInput(e) {
    if (this.data.busy || this.data.pending) return;
    const name = e.currentTarget.dataset.field; this.setData({ [name]: e.detail.value });
    if (name === 'content') { this.analysisVersion = (this.analysisVersion || 0) + 1; this.setData({ card: null, analyzing: false, cardStatus: '正文已修改，旧卡片已移除' }); }
  },
  onDate(e) { if (!this.data.pending && !this.data.busy) this.setData({ date: e.detail.value }); },
  onTime(e) { if (!this.data.pending && !this.data.busy) this.setData({ at: e.detail.value }); },
  clearTime() { if (!this.data.pending && !this.data.busy) this.setData({ at: '' }); },
  onKind(e) { if (!this.data.pending && !this.data.busy) this.setData({ kindIndex: Number(e.detail.value) }); },
  onSwitch(e) { if (!this.data.pending && !this.data.busy) this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  onImages(e) { if (!this.data.pending && !this.data.busy) { this.images = e.detail.value; this.photosConfirmed = true; this.setData({ imageCount: this.images.length }); } },
  omitPhotos() { if (!this.data.pending && !this.data.busy) { this.images = []; this.photosConfirmed = true; this.setData({ imageCount: 0, photoChoices: this.data.photoChoices.map((row) => ({ id: row.id, checked: false })) }); } },
  async analyze() {
    if (this.data.analyzing || this.data.pending || this.data.busy) return;
    if (!this.data.content.trim() || this.data.content.length > 500) { this.setData({ error: '请先把正文控制在500字以内' }); return; }
    const version = this.analysisVersion = (this.analysisVersion || 0) + 1;
    this.setData({ analyzing: true, error: '' });
    try {
      const r = await app.entryRequest({ action: 'analyze', content: this.data.content.trim(), selectedDate: this.data.date, cards: 1, excludeIds: this.ids });
      if (this.closed || version !== this.analysisVersion) return;
      if (!Array.isArray(r.events) || r.events.length !== 1) throw new Error('识别为多件事，合并预览先保留原文；如需拆分，请在首页处理');
      this.approvedTypes = r.newTypes || [];
      this.setData({ card: r.events[0].card || null, cardStatus: r.warning || '卡片仅根据合并后的原文整理，请核对数值，避免重复统计' });
    } catch (err) { if (!this.closed && version === this.analysisVersion) this.setData({ error: err.message }); }
    finally { if (!this.closed && version === this.analysisVersion) this.setData({ analyzing: false }); }
  },
  async save() {
    if (this.data.busy || this.data.analyzing || this.data.loading || !this.data.canEdit) return;
    this.setData({ busy: true, error: '' });
    try {
      if (!this.data.supported) throw new Error('合并服务尚未部署，请先保留两条原记录');
      if (!this.payload) {
        if (!this.photosConfirmed) throw new Error('请明确选择要保留的照片，或选择本次只合并文字');
        if (this.data.content.length > 500 || this.data.note.length > 200 || this.images.length > 9 || !dates.validDate(this.data.date)) throw new Error('请检查正文500字、备注200字、照片9张及日期限制');
        const r = await wx.showModal({ title: '确认合并这两条？', content: '第一条更新为上方预览，第二条移入回收站。'
          + (this.approvedTypes && this.approvedTypes.length ? '\n同时新增记录类型：' + this.approvedTypes.join('、') : ''), confirmText: '确认合并' });
        if (!r.confirm) return;
        this.payload = { action: 'merge', confirmed: true, id: this.ids[0], otherId: this.ids[1],
          revision: this.originals[0].revision || 0, otherRevision: this.originals[1].revision || 0,
          familyCode: this.member.family_code, memberId: this.member._id, requestId: outbox.id(),
          content: this.data.content, note: this.data.note, happened_on: this.data.date, at: this.data.at,
          kind: ['daily', 'first', 'health'][this.data.kindIndex], planned: this.data.planned, favorite: this.data.favorite,
          images: this.images.slice(), card: this.data.card, approvedTypes: this.approvedTypes || [] };
        try { wx.setStorageSync(this.key, this.payload); } catch (err) { this.payload = null; throw new Error('本机未能保存提交提案，尚未合并，请重试'); }
        this.setData({ pending: true });
      }
      await app.entryRequest(Object.assign({}, this.payload, { action: 'merge' }));
      wx.removeStorageSync(this.key); wx.removeStorageSync(this.key + ':draft'); this.payload = null;
      wx.showToast({ title: '已合并', icon: 'none' });
      wx.redirectTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(this.ids[0]) });
    } catch (err) {
      if (err.code === 'CONFLICT' && this.payload) {
        this.payload.failureCode = 'CONFLICT';
        try { wx.setStorageSync(this.key, this.payload); } catch (storageError) { /* 原提案仍保留，页面可继续核对。 */ }
      }
      if (!this.closed) this.setData({ error: err.message || '结果待确认，请使用原提案重试', canReset: err.code === 'CONFLICT' });
    }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  async checkResult() {
    if (!this.payload || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const r = await app.entryRequest({ action: 'mergeStatus', id: this.payload.id, revision: this.payload.revision,
        memberId: this.member._id, familyCode: this.member.family_code, requestId: this.payload.requestId });
      if (r.applied) {
        wx.removeStorageSync(this.key); wx.removeStorageSync(this.key + ':draft');
        wx.redirectTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(this.ids[0]) });
      } else this.setData({ error: '尚未找到此合并回执，可沿用原提案重试；原记录版本冲突时可重新读取调整' });
    } catch (err) { if (!this.closed) this.setData({ error: err.message }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  async resetProposal() {
    if (!this.data.canReset || this.data.busy || !this.payload) return;
    const r = await wx.showModal({ title: '重新核对最新原记录？', content: '保留上次合并的正文、备注和选取，重新读取两条原记录；旧卡片将清除，需要再次核对确认。' });
    if (!r.confirm) return;
    try {
      wx.setStorageSync(this.key + ':draft', Object.assign({}, this.payload, { card: null }));
      wx.removeStorageSync(this.key); this.payload = null; this.setData({ pending: false, canReset: false }); this.load();
    } catch (err) { this.setData({ error: '未能保留原提案，请勿清理本机数据' }); }
  },
  open(e) { wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
});
