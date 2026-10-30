const app = getApp();
const dates = require('../../utils/date');
const { validResult, readImage } = require('../../utils/pictures');
Page({
  data: { busy: false, supported: false, visionSupported: false, ocrSupported: false, canEdit: false, text: '', image: '', attach: false, error: '', status: '', modeIndex: 0,
    modes: ['智能识图：文字与动作', '手写或密集文字', '只提取图片文字'] },
  onLoad() { this.init(); },
  onUnload() { this.closed = true; this.version = (this.version || 0) + 1; this.persist(); },
  async init() {
    try {
      const member = await app.ensureMember(); if (!member) throw new Error('请先加入家庭'); this.member = member;
      this.key = 'ocrDraft:' + member._id + ':' + member.family_code;
      const draft = wx.getStorageSync(this.key);
      if (typeof draft === 'string') this.setData({ text: draft, status: '已恢复上次未带入的文字；图片需重新选择' });
      const caps = await app.getEntryCapabilities();
      if (!this.closed) this.setData({ supported: caps.pictureUnderstanding === 1 || caps.imageText === 1,
        visionSupported: caps.pictureUnderstanding === 1, ocrSupported: caps.imageText === 1, canEdit: ['owner', 'editor'].includes(member.role) });
    } catch (err) { if (!this.closed) this.setData({ error: err.message }); }
  },
  onMode(e) { if (!this.data.busy) this.setData({ modeIndex: Number(e.detail.value) }); },
  async pick() {
    if (this.data.busy) return;
    if (!this.available()) return;
    try {
      const r = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'] });
      if (this.closed) return;
      if (!r.tempFiles || !r.tempFiles[0] || !r.tempFiles[0].tempFilePath) throw new Error('没有取得图片，请重新选择');
      this.lastPictureResult = null;
      this.lastPictureBlock = '';
      this.setData({ image: r.tempFiles[0].tempFilePath, attach: false, error: '', status: '图片尚未上传；点击识别后交由识别服务处理' });
    } catch (err) { if (!this.closed && !/cancel/.test(err.errMsg || '')) this.setData({ error: err.message || '选择图片失败，请重试' }); }
  },
  available() {
    const ready = this.data.modeIndex === 0 ? this.data.visionSupported : this.data.ocrSupported;
    if (!ready) this.setData({ error: this.data.modeIndex === 0 ? '智能识图接口尚未启用，可先粘贴文字继续' : '此文字识别方式尚未开通，可选择智能识图或粘贴文字' });
    return ready;
  },
  async recognize() {
    if (this.data.busy || !this.data.image) return;
    if (!this.available()) return;
    const version = this.version = (this.version || 0) + 1;
    this.setData({ busy: true, error: '', status: '正在准备图片…' });
    try {
      const member = await app.ensureMember();
      if (!member || member._id !== this.member._id || member.family_code !== this.member.family_code || !['owner', 'editor'].includes(member.role)) throw new Error('家庭身份或权限已变化，请重新进入');
      const image = await readImage(this.data.image, member);
      if (this.closed || version !== this.version) return;
      this.setData({ status: '正在识别，随后可编辑核对…' });
      const vision = this.data.modeIndex === 0;
      const r = await app.entryRequest(vision ? { action: 'analyzePicture', image, memberId: member._id, familyCode: member.family_code }
        : { action: 'recognizeImage', image, mode: this.data.modeIndex === 1 ? 'accurate' : 'basic' });
      if (this.closed || version !== this.version) return;
      const current = app.globalData.member;
      if (!current || current._id !== member._id || current.family_code !== member.family_code) throw new Error('家庭身份已变化，未带入识别结果');
      const analysis = vision ? r.analysis : null;
      if (vision && !validResult(analysis)) throw new Error('图片结果格式异常，请重新识别');
      const text = vision && analysis ? [analysis.caption ? '照片描述：' + analysis.caption : '',
        analysis.text ? (analysis.incomplete ? '图片部分文字：' : '图片文字：') + analysis.text : ''].filter(Boolean).join('\n') : r.text;
      if (typeof text !== 'string' || !text.trim()) throw new Error(analysis && analysis.warning || '没有取得可靠描述或可读文字，可以手动补充');
      if (this.data.text.trim()) {
        const result = await wx.showModal({ title: '替换当前文字？', content: '新识别结果尚未带入首页，选择取消会保留当前编辑。', confirmText: '使用新结果' });
        if (!result.confirm) return;
      }
      this.lastPictureResult = analysis;
      this.lastPictureBlock = vision ? text : '';
      this.setData({ text, status: vision ? [analysis.warning, analysis.incomplete ? '文字未完整读取，请裁剪或只采用已核对的部分。' : '',
        '已生成图片草稿，请对照原图核对动作、日期和数量。'].filter(Boolean).join(' ') : '已识别 ' + r.lines + ' 行；请核对数字、日期与事件顺序' }); this.persist();
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
        images: savedPath ? [savedPath] : [], kind: 'daily', date: today, baseDate: today,
        imageInsights: savedPath && this.lastPictureResult ? [{ path: savedPath, status: 'done', result: this.lastPictureResult, error: '', applied: this.lastPictureBlock || '' }] : [] } };
      this.transferred = true; wx.removeStorageSync(this.key);
      wx.switchTab({ url: '/pages/index/index' });
    } catch (err) { if (savedPath) wx.removeSavedFile({ filePath: savedPath, fail: () => {} }); if (!this.closed) this.setData({ error: err.message || '未能带入，请保留文字后重试' }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
});
