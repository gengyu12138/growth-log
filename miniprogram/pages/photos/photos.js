const app = getApp();
Page({
  data: { groups: [], loading: false, error: '', hasMore: false },
  onLoad() { this.rows = []; this.load(); },
  onUnload() { this.disposed = true; },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const member = await app.ensureMember();
      if (!member) throw new Error('请先加入家庭');
      const r = await app.listEntries({ action: 'list', cursor: this.cursor || null });
      if (this.disposed) return;
      if (!r || !r.ok || !Array.isArray(r.list) || !Object.prototype.hasOwnProperty.call(r, 'nextCursor')
        || !r.member || r.member.family_code !== member.family_code) throw new Error('照片记录读取失败，请重试');
      if (r.nextCursor && JSON.stringify(r.nextCursor) === JSON.stringify(this.cursor)) throw new Error('翻页位置未更新，请重新进入');
      const known = new Set(this.rows.map((e) => e._id));
      this.rows.push(...r.list.filter((e) => !known.has(e._id) && !e.planned && Array.isArray(e.images) && e.images.length));
      this.cursor = r.nextCursor;
      const groups = new Map(), seen = new Set();
      for (const row of this.rows) {
        const month = row.happened_on.slice(0, 7);
        if (!groups.has(month)) groups.set(month, { month, photos: [] });
        for (const src of row.images) {
          if (seen.has(src)) continue;
          seen.add(src); groups.get(month).photos.push({ src, id: row._id, date: row.happened_on, text: row.content || '照片记录' });
        }
      }
      this.setData({ groups: [...groups.values()], hasMore: !!this.cursor });
    } catch (err) { if (!this.disposed) this.setData({ error: err.message }); }
    finally { if (!this.disposed) this.setData({ loading: false }); }
  },
  open(e) { wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  preview(e) {
    const group = this.data.groups[Number(e.currentTarget.dataset.group)];
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: group.photos.map((p) => p.src) });
  },
});
