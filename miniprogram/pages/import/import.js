const app = getApp();
const dates = require('../../utils/date');
Page({
  data: { busy: false, supported: false, canEdit: false, text: '', image: '', attach: false, error: '', status: '', modeIndex: 0,
    modes: ['照片与截图', '手写或小字（高精度）'] },
  onLoad() { this.init(); },
  onUnload() { this.closed = true; this.version = (this.version || 0) + 1; this.persist(); },
  async init() {
    try {
      const member = await app.ensureMember(); if (!member) throw new Error('请先加入家庭'); this.member = member;
      this.key = 'ocrDraft:' + member._id + ':' + member.family_code;
      const draft = wx.getStorageSync(this.key);
      if (typeof draft === 'string') this.setData({ text: draft, status: '已恢复上次未带入的文字；图片需重新选择' });
      const caps = await app.getEntryCapabilities();
      if (!this.closed) this.setData({ supported: caps.imageText === 1, canEdit: ['owner', 'editor'].includes(member.role) });
    } catch (err) { if (!this.closed) this.setData({ error: err.message }); }
  },
  onMode(e) { if (!this.data.busy) this.setData({ modeIndex: Number(e.detail.value) }); },
  async pick() {
    if (this.data.busy) return;
    if (!this.data.supported) { this.setData({ error: '照片文字识别尚未开通，暂不申请相册权限；可以粘贴文字继续' }); return; }
    try {
      const r = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'] });
      if (this.closed) return;
      if (!r.tempFiles || !r.tempFiles[0] || !r.tempFiles[0].tempFilePath) throw new Error('没有取得图片，请重新选择');
      this.setData({ image: r.tempFiles[0].tempFilePath, attach: false, error: '', status: '图片尚未上传；点击识别后交由识别服务处理' });
    } catch (err) { if (!this.closed && !/cancel/.test(err.errMsg || '')) this.setData({ error: err.message || '选择图片失败，请重试' }); }
  },
  async recognize() {
    if (this.data.busy || !this.data.image) return;
    const version = this.version = (this.version || 0) + 1;
    this.setData({ busy: true, error: '', status: '正在准备图片…' });
    try {
      const member = await app.ensureMember();
      if (!member || member._id !== this.member._id || member.family_code !== this.member.family_code || !['owner', 'editor'].includes(member.role)) throw new Error('家庭身份或权限已变化，请重新进入');
      let path = this.data.image;
      const read = (filePath) => new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: resolve, fail: reject }));
      let image = (await read(path)).data;
      if (image.length > 900000) {
        const compressed = await wx.compressImage({ src: path, quality: 60, compressedWidth: 1600 });
        path = compressed.tempFilePath; image = (await read(path)).data;
      }
      if (image.length > 900000) throw new Error('图片仍然过大，请裁剪到本次需要记录的部分后重新选择');
      if (this.closed || version !== this.version) return;
      this.setData({ status: '正在识别，随后可编辑核对…' });
      const r = await app.entryRequest({ action: 'recognizeImage', image, mode: this.data.modeIndex ? 'accurate' : 'basic' });
      if (this.closed || version !== this.version) return;
      const current = app.globalData.member;
      if (!current || current._id !== member._id || current.family_code !== member.family_code) throw new Error('家庭身份已变化，未带入识别结果');
      if (typeof r.text !== 'string' || !r.text.trim()) throw new Error('识别结果为空，请重试');
      if (this.data.text.trim()) {
        const result = await wx.showModal({ title: '替换当前文字？', content: '新识别结果尚未带入首页，选择取消会保留当前编辑。', confirmText: '使用新结果' });
        if (!result.confirm) return;
      }
      this.setData({ text: r.text, status: '已识别 ' + r.lines + ' 行；请核对数字、日期与事件顺序' }); this.persist();
    } catch (err) { if (!this.closed && version === this.version) this.setData({ error: err.message || '照片识别失败，请重试', status: '尚未保存记录' }); }
    finally { if (!this.closed && version === this.version) this.setData({ busy: false }); }
  },
  onText(e) { if (!this.data.busy) { this.setData({ text: e.detail.value }); this.persist(); } },
  persist() { if (!this.key || this.transferred) return; try { wx.setStorageSync(this.key, this.data.text); } catch (err) { if (!this.closed) this.setData({ error: '识别文字尚未存到本机，请保留原文后重试' }); } },
  onAttach(e) { if (!this.data.busy) this.setData({ attach: e.detail.value }); },
  preview() { if (this.data.image) wx.previewImage({ urls: [this.data.image] }); },
  async bring() {
    if (this.data.busy || !this.data.text.trim() || this.data.text.length > 500) return;
    this.setData({ busy: true, error: '' });
    let savedPath = '';
    try {
      const member = await app.ensureMember();
      if (!member || member._id !== this.member._id || member.family_code !== this.member.family_code || !['owner', 'editor'].includes(member.role)) throw new Error('家庭身份已变化，请重新进入');
      if (this.data.attach && this.data.image) savedPath = (await wx.saveFile({ tempFilePath: this.data.image })).savedFilePath;
      const today = dates.fmtDate(new Date());
      app.globalData.entryImport = { memberId: member._id, familyCode: member.family_code, form: { text: this.data.text.trim(),
        images: savedPath ? [savedPath] : [], kind: 'daily', date: today, baseDate: today } };
      this.transferred = true; wx.removeStorageSync(this.key);
      wx.switchTab({ url: '/pages/index/index' });
    } catch (err) { if (savedPath) wx.removeSavedFile({ filePath: savedPath, fail: () => {} }); if (!this.closed) this.setData({ error: err.message || '未能带入，请保留文字后重试' }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
});
