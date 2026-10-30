const app = getApp();
const review = require('../../utils/review');
Page({
  data: { loading: false, pairs: [], error: '', status: '', ignored: 0, canEdit: false },
  onShow() { this.load(); },
  onUnload() { this.closed = true; this.version = (this.version || 0) + 1; },
  async load() {
    const version = this.version = (this.version || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const member = await app.ensureMember();
      if (!member) throw new Error('请先加入家庭');
      this.member = member; this.key = 'duplicateChecks:' + member._id + ':' + member.family_code;
      this.checked = wx.getStorageSync(this.key) || [];
      if (!Array.isArray(this.checked) || this.checked.some((v) => typeof v !== 'string')) throw new Error('本机核对状态异常，请保留数据后联系管理员');
      const rows = await app.collectEntries({}, member.family_code, () => version !== this.version);
      if (version !== this.version) return;
      this.pairs = review.pairs(rows).map((pair) => Object.assign({}, pair, { checkKey: pair.key + ':' + (pair.first.revision || 0) + ':' + (pair.second.revision || 0) }));
      this.setData({ status: '已检查 ' + rows.length + ' 条，最多展示50组候选', canEdit: ['owner', 'editor'].includes(member.role) }); this.render();
    } catch (err) { if (version === this.version) this.setData({ error: err.message }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  render() { this.setData({ pairs: this.pairs.filter((pair) => !this.checked.includes(pair.checkKey)), ignored: this.pairs.filter((pair) => this.checked.includes(pair.checkKey)).length }); },
  keep(e) {
    try { const pair = this.pairs.find((item) => item.key === e.currentTarget.dataset.key); if (!pair) return;
      this.checked = this.checked.slice(-499).concat(pair.checkKey); wx.setStorageSync(this.key, this.checked); this.render();
    } catch (err) { this.setData({ error: '本机核对结果未能保存，请重试' }); }
  },
  reset() { try { wx.removeStorageSync(this.key); this.checked = []; this.render(); } catch (err) { this.setData({ error: '无法更新本机状态，请重试' }); } },
  open(e) { wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  merge(e) { wx.navigateTo({ url: '/pages/merge/merge?id=' + encodeURIComponent(e.currentTarget.dataset.id) + '&other=' + encodeURIComponent(e.currentTarget.dataset.other) }); },
});
