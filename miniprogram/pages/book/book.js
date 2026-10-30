const app = getApp();
const dates = require('../../utils/date');
const config = require('../../utils/config');
const { growthBook } = require('../../utils/book');
const { backupPhotos } = require('../../utils/backup');
const unique = (values) => [...new Set(values)];
Page({
  data: { loading: false, busy: false, error: '', status: '', start: '', end: '', rangeChanged: false,
    title: '', subtitle: '', message: '', chapters: [], choices: [], photos: [], recordCount: 0, selectedCount: 0, selectedPhotoCount: 0,
    missingCount: 0, coverId: '', pickingRecords: false, pickingPhotos: false, withPhotos: false, preview: false, previewChapters: [], exportStatus: '', exportPath: '' },
  onLoad() { this.load(); },
  onUnload() {
    this.closed = true; this.version = (this.version || 0) + 1; this.persist();
    if (this.data.exportPath) wx.getFileSystemManager().unlink({ filePath: this.data.exportPath, fail: () => {} });
  },
  async load() {
    if (this.data.busy) return;
    const version = this.version = (this.version || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const member = await app.ensureMember(); if (!member) throw new Error('请先加入家庭'); this.member = member;
      this.key = 'bookDraft:' + member._id + ':' + member.family_code;
      const draft = wx.getStorageSync(this.key), year = String(new Date().getFullYear());
      if (draft && (!dates.validDate(draft.start) || !dates.validDate(draft.end) || typeof draft.title !== 'string'
        || !Array.isArray(draft.selectedIds) || !Array.isArray(draft.photoIds) || !Array.isArray(draft.chapters))) throw new Error('成长册草稿格式异常，请保留本机数据后联系管理员');
      this.rows = (await app.collectEntries({}, member.family_code, () => version !== this.version)).filter((row) => !row.planned);
      if (version !== this.version) return;
      this.chapterDrafts = draft ? draft.chapters : [];
      this.setData({ start: draft ? draft.start : year + '-01-01', end: draft ? draft.end : year + '-12-31',
        title: draft ? draft.title : year + '，一起长大', subtitle: draft && draft.subtitle || '', message: draft && draft.message || '',
        coverId: draft && draft.coverId || '', withPhotos: draft && draft.withPhotos === true, status: draft ? '已恢复本机成长册草稿' : '选取记录后，可自由调整章节和寄语' });
      this.appliedStart = this.data.start; this.appliedEnd = this.data.end;
      this.selectedIds = draft ? draft.selectedIds : this.inRange().map((row) => row._id);
      this.photoIds = draft ? draft.photoIds : unique(this.inRange().flatMap((row) => row.images || []));
      this.render();
    } catch (err) { if (version === this.version) this.setData({ error: err.message }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  inRange() { return (this.rows || []).filter((row) => row.happened_on >= this.appliedStart && row.happened_on <= this.appliedEnd); },
  selected() { return this.inRange().filter((row) => (this.selectedIds || []).includes(row._id)); },
  render() {
    const rows = this.inRange(), selected = this.selected(), ids = new Set(rows.map((row) => row._id));
    const imageIds = unique(selected.flatMap((row) => row.images || []));
    const months = unique(selected.map((row) => row.happened_on.slice(0, 7))).sort();
    const chapters = months.map((month) => { const existing = (this.chapterDrafts || []).find((item) => item.month === month);
      return { month, title: existing ? existing.title : month + ' · 成长片段', note: existing ? existing.note : '', count: selected.filter((row) => row.happened_on.slice(0, 7) === month).length }; });
    this.setData({ choices: rows.map((row) => ({ _id: row._id, content: row.content, happened_on: row.happened_on, checked: this.selectedIds.includes(row._id) })),
      chapters, recordCount: rows.length, selectedCount: selected.length, missingCount: this.selectedIds.filter((id) => !ids.has(id)).length,
      photos: imageIds.map((id) => ({ id, checked: this.photoIds.includes(id) })), selectedPhotoCount: imageIds.filter((id) => this.photoIds.includes(id)).length,
      previewChapters: chapters.map((chapter) => Object.assign({}, chapter, { entries: selected.filter((row) => row.happened_on.slice(0, 7) === chapter.month).sort((a, b) => a.happened_on.localeCompare(b.happened_on)).slice(0, 3) })) });
  },
  persist() {
    if (!this.key || !this.rows) return;
    try { wx.setStorageSync(this.key, { start: this.appliedStart, end: this.appliedEnd, title: this.data.title,
      subtitle: this.data.subtitle, message: this.data.message, chapters: this.chapterDrafts || [], selectedIds: this.selectedIds || [],
      photoIds: this.photoIds || [], coverId: this.data.coverId, withPhotos: this.data.withPhotos }); }
    catch (err) { if (!this.closed) this.setData({ error: '成长册草稿未能保存在本机，请保留当前编辑后重试' }); }
  },
  onInput(e) { if (!this.data.busy) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); this.persist(); } },
  onDate(e) { if (!this.data.busy) this.setData({ [e.currentTarget.dataset.field]: e.detail.value, rangeChanged: true }); },
  async applyRange() {
    if (this.data.busy || !this.rows) return;
    if (!dates.validDate(this.data.start) || !dates.validDate(this.data.end) || this.data.start > this.data.end) { this.setData({ error: '开始日期不能晚于结束日期' }); return; }
    if (this.appliedStart !== this.data.start || this.appliedEnd !== this.data.end) {
      const r = await wx.showModal({ title: '应用新的日期范围？', content: '将默认选中此范围内的已发生记录和照片；章节文字、标题与寄语保留。' });
      if (!r.confirm) return;
    }
    this.appliedStart = this.data.start; this.appliedEnd = this.data.end;
    this.selectedIds = this.inRange().map((row) => row._id); this.photoIds = unique(this.inRange().flatMap((row) => row.images || []));
    this.setData({ rangeChanged: false, error: '', coverId: '' }); this.render(); this.persist();
  },
  thisYear() { const year = new Date().getFullYear(); this.setData({ start: year + '-01-01', end: year + '-12-31', rangeChanged: true }); this.applyRange(); },
  async birthday() {
    if (this.data.busy) return;
    try {
      const r = await app.getBabyProfile();
      if (!r.profile || !r.member || r.member.family_code !== this.member.family_code) throw new Error('请先在家人页设置宝宝生日，或自行选择日期范围');
      const today = dates.fmtDate(new Date()), suffix = r.profile.birthday.slice(4);
      const anniversary = (year) => dates.validDate(year + suffix) ? year + suffix : year + '-02-28';
      let year = Number(today.slice(0, 4)); if (anniversary(year) > today) year -= 1;
      const start = anniversary(year), endDate = dates.parseDate(anniversary(year + 1)); endDate.setDate(endDate.getDate() - 1);
      this.setData({ start: start < r.profile.birthday ? r.profile.birthday : start, end: dates.fmtDate(endDate), rangeChanged: true }); this.applyRange();
    } catch (err) { this.setData({ error: err.message }); }
  },
  toggleRecords() { this.setData({ pickingRecords: !this.data.pickingRecords }); },
  selectAll() { if (!this.data.busy) { this.selectedIds = this.inRange().map((row) => row._id); this.render(); this.persist(); } },
  selectHighlights() { if (!this.data.busy) { this.selectedIds = this.inRange().filter((row) => row.kind === 'first' || row.favorite).map((row) => row._id); this.render(); this.persist(); } },
  onRecords(e) { if (!this.data.busy) { this.selectedIds = e.detail.value; this.render(); this.persist(); } },
  togglePhotos() { this.setData({ pickingPhotos: !this.data.pickingPhotos }); },
  onPhotos(e) { if (!this.data.busy) { this.photoIds = e.detail.value; if (!this.photoIds.includes(this.data.coverId)) this.setData({ coverId: '' }); this.render(); this.persist(); } },
  setCover(e) { if (!this.data.busy) { const id = e.currentTarget.dataset.id; this.photoIds = unique(this.photoIds.concat(id)); this.setData({ coverId: id }); this.render(); this.persist(); } },
  clearCover() { if (!this.data.busy) { this.setData({ coverId: '' }); this.persist(); } },
  onChapter(e) {
    if (this.data.busy) return;
    const month = e.currentTarget.dataset.month, field = e.currentTarget.dataset.field;
    let chapter = this.chapterDrafts.find((item) => item.month === month);
    if (!chapter) { chapter = Object.assign({}, this.data.chapters.find((item) => item.month === month)); this.chapterDrafts.push(chapter); }
    chapter[field] = e.detail.value; this.render(); this.persist();
  },
  onWithPhotos(e) { if (!this.data.busy) { this.setData({ withPhotos: e.detail.value }); this.persist(); } },
  togglePreview() { this.render(); this.setData({ preview: !this.data.preview }); },
  cancelExport() { this.cancelled = true; this.setData({ exportStatus: '正在取消，等待当前文件结束…' }); },
  async exportBook() {
    if (this.data.busy || this.data.loading || this.data.rangeChanged) return;
    const selected = this.selected();
    if (!selected.length || !this.data.title.trim()) { this.setData({ error: '请填写标题并至少选取一条记录' }); return; }
    this.cancelled = false; this.setData({ busy: true, error: '', exportStatus: '正在核对原记录…' });
    let path = '';
    try {
      const member = await app.ensureMember();
      if (!member || member._id !== this.member._id || member.family_code !== this.member.family_code) throw new Error('家庭身份已变化，请重新读取');
      const cancelled = () => this.closed || this.cancelled;
      const current = await app.collectEntries({}, member.family_code, cancelled);
      const rows = selected.map((before) => { const row = current.find((value) => value._id === before._id);
        if (!row || (row.revision || 0) !== (before.revision || 0) || row.planned) throw new Error('部分原记录已经更新或删除，请重新读取并检查选取'); return row; });
      const images = unique(rows.flatMap((row) => row.images || [])).filter((id) => this.photoIds.includes(id));
      const options = { title: this.data.title.trim(), subtitle: this.data.subtitle, message: this.data.message,
        chapters: this.data.chapters, selectedImageIds: images, coverId: images.includes(this.data.coverId) ? this.data.coverId : '' };
      const name = '成长册-' + this.appliedStart + '-' + this.appliedEnd + '-' + Date.now() + (this.data.withPhotos ? '.zip' : '.html');
      path = wx.env.USER_DATA_PATH + '/' + name;
      if (this.data.withPhotos) {
        await backupPhotos(wx, path, { format: 'growth-book-v1', exportedAt: new Date().toISOString(), scope: { start: this.appliedStart, end: this.appliedEnd },
          count: rows.length, entries: rows, book: options }, member.family_code, config.envId, cancelled,
        (exportStatus) => { if (!this.closed) this.setData({ exportStatus }); }, options);
      } else await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data: growthBook(rows, options.title, [], options), encoding: 'utf8', success: resolve, fail: reject }));
      if (cancelled()) throw new Error('已取消制作');
      const old = this.data.exportPath;
      this.setData({ exportPath: path, exportName: name, exportStatus: '已生成 ' + rows.length + ' 条记录的' + (this.data.withPhotos ? '照片成长册' : '文字成长册') + '，文件尚未发送' });
      if (old) wx.getFileSystemManager().unlink({ filePath: old, fail: () => {} });
    } catch (err) { if (path) wx.getFileSystemManager().unlink({ filePath: path, fail: () => {} }); if (!this.closed) this.setData({ error: this.cancelled ? '' : err.message, exportStatus: '本次制作未完成' }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  share() {
    if (this.data.busy || !this.data.exportPath) return;
    if (!wx.shareFileMessage) { this.setData({ error: '当前微信不支持发送文件，请升级后再试' }); return; }
    wx.shareFileMessage({ filePath: this.data.exportPath, fileName: this.data.exportName, fail: (err) => { if (!/cancel/.test(err.errMsg || '')) this.setData({ error: '发送失败，文件仍保留，可重试' }); } });
  },
});
