const app = getApp();
const dateUtil = require('../../utils/date');
const { backupPhotos } = require('../../utils/backup');
const config = require('../../utils/config');
const { growthBook } = require('../../utils/book');
const ACTIONS = { add: '新增了记录', update: '编辑了记录', remove: '将记录移入回收站',
  restore: '恢复了记录', favorite: '更新了里程碑收藏', tag: '触发了自动整理' };

Page({
  data: { tab: 'favorites', rows: [], loading: false, busy: false, error: '', hasMore: false,
    canEdit: false, month: '', exportAll: false, exportStatus: '', exportPath: '',
    bookOnly: false, exportFormats: ['完整数据备份（JSON）', '可阅读成长册（HTML）'], formatIndex: 0,
    withPhotos: false, photoStart: '', photoEnd: '',
    tabs: [{ key: 'favorites', label: '珍藏' }, { key: 'trash', label: '回收站' },
      { key: 'history', label: '操作记录' }, { key: 'export', label: '导出' }] },

  onLoad() { this.setData({ month: dateUtil.fmtDate(new Date()).slice(0, 7) }); },
  onShow() { this.load(); },
  onUnload() {
    this.loadId = (this.loadId || 0) + 1;
    this.closed = true;
    if (this.data.exportPath) wx.getFileSystemManager().unlink({ filePath: this.data.exportPath, fail: () => {} });
  },

  onTab(e) {
    if (this.data.busy || e.currentTarget.dataset.tab === this.data.tab) return;
    this.setData({ tab: e.currentTarget.dataset.tab });
    this.load();
  },

  async load(append = false) {
    if (this.data.busy || (append && (this.data.loading || !this.cursor))) return;
    const loadId = this.loadId = (this.loadId || 0) + 1;
    const tab = this.data.tab;
    if (!append) { this.cursor = null; this.setData({ rows: [], hasMore: false }); }
    this.setData({ loading: true, error: '', canEdit: false });
    try {
      const member = await app.ensureMember();
      if (!member) throw new Error('请先加入家庭');
      await app.requireRecordTools();
      if (loadId !== this.loadId) return;
      this.member = member;
      this.setData({ canEdit: ['owner', 'editor'].includes(member.role) });
      if (tab === 'export') return;
      const r = await app.entryRequest(tab === 'history'
        ? { action: 'history', cursor: this.cursor }
        : { action: 'list', scope: tab, cursor: this.cursor });
      if (loadId !== this.loadId) return;
      if (!Array.isArray(r.list) || !Object.prototype.hasOwnProperty.call(r, 'nextCursor')) throw new Error('返回格式错误');
      if (!r.member || r.member.family_code !== member.family_code) throw new Error('家庭身份已变化，请重新打开页面');
      if (r.nextCursor && JSON.stringify(r.nextCursor) === JSON.stringify(this.cursor)) throw new Error('翻页位置没有更新');
      const seen = new Set(this.data.rows.map((r) => r._id));
      const rows = r.list.filter((row) => !seen.has(row._id)).map((row) => Object.assign({}, row, {
        actionLabel: row.action === 'favorite' ? (row.favorite ? '收藏了里程碑' : '取消了里程碑收藏')
          : ACTIONS[row.action] || row.action,
        timeLabel: dateUtil.fmtDate(new Date(row.created_at)) + ' ' + dateUtil.fmtTime(row.created_at),
      }));
      this.cursor = r.nextCursor;
      this.setData({ rows: this.data.rows.concat(rows), hasMore: Boolean(this.cursor) });
    } catch (err) {
      if (loadId === this.loadId) this.setData({ error: err.message || '读取失败，请重试' });
    } finally {
      if (loadId === this.loadId) this.setData({ loading: false });
    }
  },

  retry() { this.load(Boolean(this.cursor)); },
  more() { this.load(true); },
  onMonth(e) { if (!this.data.busy) this.setData({ month: e.detail.value }); },
  onExportAll(e) { if (!this.data.busy) this.setData({ exportAll: e.detail.value }); },
  onFormat(e) { if (!this.data.busy) this.setData({ formatIndex: Number(e.detail.value), bookOnly: Number(e.detail.value) === 1 }); },
  onWithPhotos(e) { if (!this.data.busy) this.setData({ withPhotos: e.detail.value }); },
  onPhotoStart(e) { if (!this.data.busy) this.setData({ photoStart: e.detail.value }); },
  onPhotoEnd(e) { if (!this.data.busy) this.setData({ photoEnd: e.detail.value }); },
  clearPhotoDates() { if (!this.data.busy) this.setData({ photoStart: '', photoEnd: '' }); },
  cancelExport() { this.exportCancelled = true; this.setData({ exportStatus: '正在取消，等待当前文件处理结束…' }); },
  onOpen(e) {
    wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(e.currentTarget.dataset.id) });
  },
  onPreview(e) { wx.previewImage({ current: e.currentTarget.dataset.src, urls: e.currentTarget.dataset.images }); },

  onRestore(e) {
    if (this.data.busy || !this.data.canEdit) return;
    const entry = this.data.rows.find((row) => row._id === e.currentTarget.dataset.id);
    if (!entry) return;
    wx.showModal({ title: '恢复这条记录？', content: '恢复后会重新出现在原日期。', success: async (r) => {
      if (!r.confirm || this.data.busy) return;
      this.setData({ busy: true, error: '' });
      try {
        await app.entryRequest({ action: 'restore', id: entry._id, revision: entry.revision || 0 });
        wx.showToast({ title: '已恢复', icon: 'none' });
        this.setData({ busy: false });
        await this.load();
      } catch (err) { this.setData({ error: err.message }); }
      finally { this.setData({ busy: false }); }
    } });
  },

  async onExport() {
    if (this.data.busy || this.data.loading || !this.member) return;
    this.setData({ busy: true, error: '', exportStatus: '正在读取记录…' });
    const all = this.data.exportAll;
    const month = this.data.month;
    const withPhotos = this.data.withPhotos;
    const start = this.data.photoStart, end = this.data.photoEnd;
    this.exportCancelled = false;
    const cancelled = () => this.closed || this.exportCancelled;
    let filePath = '';
    try {
      if (withPhotos && ((start && !dateUtil.validDate(start)) || (end && !dateUtil.validDate(end)) || (start && end && start > end))) {
        throw new Error('请检查照片日期范围，开始日期不能晚于结束日期');
      }
      await app.requireRecordTools();
      let rows = await app.collectEntries(all ? {} : { month }, this.member.family_code, cancelled,
        (count) => this.setData({ exportStatus: '已读取 ' + count + ' 条…' }));
      if (withPhotos) rows = rows.filter((e) => (!start || e.happened_on >= start) && (!end || e.happened_on <= end));
      const fileName = '成长记录-' + (all ? '全部' : month) + '-' + Date.now() + (withPhotos ? '.zip' : this.data.bookOnly ? '.html' : '.json');
      filePath = wx.env.USER_DATA_PATH + '/' + fileName;
      const payload = { format: 'growth-log-v1', exportedAt: new Date().toISOString(),
        scope: all ? 'all-active' : month, count: rows.length,
        imageNotice: '图片为云文件引用，不包含图片原文件；回收站记录不在本次导出范围。', entries: rows };
      const fs = wx.getFileSystemManager();
      let photoCount = 0;
      if (withPhotos) {
        payload.dateRange = { start, end };
        const result = await backupPhotos(wx, filePath, payload, this.member.family_code, config.envId, cancelled,
          (exportStatus) => { if (!this.closed) this.setData({ exportStatus }); });
        photoCount = result.count;
      } else {
        await new Promise((resolve, reject) => fs.writeFile({ filePath, data: this.data.bookOnly ? growthBook(rows, (all ? '家庭' : month) + '成长回忆') : JSON.stringify(payload, null, 2), encoding: 'utf8', success: resolve, fail: reject }));
      }
      if (cancelled()) throw new Error('已取消备份');
      const previous = this.data.exportPath;
      this.setData({ exportPath: filePath, exportName: fileName,
        exportStatus: '已生成 ' + rows.length + ' 条记录' + (withPhotos ? '、' + photoCount + ' 张照片的备份包' : '') + '，请保存或发送文件。' });
      if (previous) fs.unlink({ filePath: previous, fail: () => {} });
    } catch (err) {
      if (filePath) wx.getFileSystemManager().unlink({ filePath, fail: () => {} });
      if (!this.closed) this.setData({ error: cancelled() ? '' : err.message || '导出失败，请重试',
        exportStatus: cancelled() ? '已取消，未生成新的备份文件' : '本次导出未完成' });
    } finally { if (!this.closed) this.setData({ busy: false }); }
  },

  shareExport() {
    if (!this.data.exportPath || this.data.busy) return;
    if (!wx.shareFileMessage) { this.setData({ error: '当前微信不支持发送文件，请升级微信后重试' }); return; }
    wx.shareFileMessage({ filePath: this.data.exportPath, fileName: this.data.exportName,
      fail: (err) => { if (!String(err.errMsg).includes('cancel')) this.setData({ error: '发送失败，文件仍保留，可重试' }); } });
  },
});
