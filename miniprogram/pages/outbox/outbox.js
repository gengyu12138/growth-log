const app = getApp();
const outbox = require('../../utils/outbox');
const LABELS = { draft: '未确认草稿', queued: '等待同步', sending: '同步中', uncertain: '结果待核对', blocked: '需要处理' };
Page({
  data: { rows: [], busy: false, error: '', saved: [] },
  onShow() { this.load(); },
  onUnload() { this.closed = true; },
  load() {
    if (this.data.busy) return;
    try {
      const member = app.globalData.member || app.getLocalMember();
      if (!member) throw new Error('请先加入家庭');
      this.member = member;
      const pending = wx.getStorageSync('pendingEntry:' + member._id);
      if (pending) outbox.importPending(member, pending);
      this.refresh();
    } catch (err) { this.setData({ error: err.message }); }
  },
  refresh() {
    this.setData({ rows: outbox.read(this.member).map((item) => Object.assign({}, item, {
      statusLabel: LABELS[item.status], editable: !item.attempts && item.status !== 'sending', count: item.payload && item.payload.items ? item.payload.items.length : 1,
    })) });
  },
  async sync() {
    if (this.data.busy || !this.member) return;
    this.setData({ busy: true, error: '' });
    try {
      const r = await outbox.flush(app, this.member, { force: true });
      if (!this.closed) this.setData({ saved: r.sent, error: r.error });
    } catch (err) { if (!this.closed) this.setData({ error: err.message }); }
    finally { if (!this.closed) { this.setData({ busy: false }); this.refresh(); } }
  },
  edit(e) {
    if (this.data.busy) return;
    try {
      const item = outbox.read(this.member).find((row) => row.id === e.currentTarget.dataset.id);
      if (!item || item.attempts || item.status === 'sending') throw new Error('此项已发起保存，请先核对结果');
      // 先撤回自动同步，再带入首页；原稿保留至用户重新确认。
      outbox.patch(this.member, item.id, { confirmed: false, payload: null, status: 'draft', error: '' });
      app.globalData.entryImport = { memberId: this.member._id, familyCode: this.member.family_code, id: item.id, form: item.form };
      wx.switchTab({ url: '/pages/index/index' });
    } catch (err) { this.setData({ error: err.message }); }
  },
  async discard(e) {
    if (this.data.busy) return;
    const r = await wx.showModal({ title: '删除这份本机草稿？', content: '尚未同步的文字和照片将无法恢复。', confirmText: '删除', confirmColor: '#a13e35' });
    if (!r.confirm) return;
    try { outbox.remove(this.member, e.currentTarget.dataset.id); this.refresh(); }
    catch (err) { this.setData({ error: err.message }); }
  },
  async check(e) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const item = outbox.read(this.member).find((row) => row.id === e.currentTarget.dataset.id);
      if (!item || !item.payload) throw new Error('请先刷新状态');
      if (item.legacyUnsafe) {
        wx.navigateTo({ url: '/pages/search/search?q=' + encodeURIComponent(item.form.text.slice(0, 30)) });
        throw new Error('此为旧版未确认提交，请先按原文核对；不能仅凭新提交标识认定未保存');
      }
      const r = await app.entryRequest({ action: 'submissionStatus', requestId: item.id, batch: !!item.payload.items,
        count: item.payload.items ? item.payload.items.length : 1, expectedFamilyCode: this.member.family_code, expectedMemberId: this.member._id });
      if (!Array.isArray(r.records)) throw new Error('核对结果异常');
      if (r.records.length === (item.payload.items ? item.payload.items.length : 1)) {
        outbox.remove(this.member, item.id, true);
        this.setData({ saved: r.records.filter((row) => !row.deleted).map((row) => row.id), error: r.records.some((row) => row.deleted) ? '此提交已保存，部分记录后来移入回收站；本机重复提交已清理' : '云端已保存，本机重复提交已清理' });
      } else if (!r.records.length && item.definiteRejection && !item.everUncertain) {
        const choice = await wx.showModal({ title: '云端未保存这次提交', content: '服务明确拒绝了保存，且未查到对应记录。可以转回本机草稿，修正后重新确认。', confirmText: '转为草稿' });
        if (choice.confirm) outbox.patch(this.member, item.id, { confirmed: false, payload: null, status: 'draft', attempts: 0, error: '', lastAttempt: 0 });
      } else this.setData({ error: r.records.length ? '只找到部分结果，请保留本机内容并联系管理员' : '暂未找到此提交；可以使用原提交标识重试同步' });
    } catch (err) { if (!this.closed) this.setData({ error: err.message }); }
    finally { if (!this.closed) { this.setData({ busy: false }); this.refresh(); } }
  },
  open(e) { wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  async resolveLegacy(e) {
    if (this.data.busy) return;
    try {
      const item = outbox.read(this.member).find((row) => row.id === e.currentTarget.dataset.id);
      if (!item || !item.legacyUnsafe) return;
      const choice = await wx.showActionSheet({ itemList: ['已确认云端保存，清除本机旧提交', '已确认云端未保存，转回草稿'] });
      const r = await wx.showModal({ title: '按人工核对结果处理？', content: choice.tapIndex === 0
        ? '只清除本机的旧提交，云端原记录不会删除。请确认已在已有记录中找到完整内容。'
        : '转回未确认草稿，不会立即提交。请确认云端没有该内容，以免重复保存。' });
      if (!r.confirm) return;
      if (choice.tapIndex === 1) outbox.add(this.member, item.form);
      outbox.remove(this.member, item.id, true);
      const key = 'pendingEntry:' + this.member._id, pending = wx.getStorageSync(key);
      if (pending && pending.requestId === item.id && pending.familyCode === this.member.family_code) wx.removeStorageSync(key);
      this.refresh();
    } catch (err) { if (!/cancel/.test(err.errMsg || '')) this.setData({ error: err.message || '旧提交尚未处理，请保留内容后重试' }); }
  },
});
