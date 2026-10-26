const app = getApp();

Page({
  data: {
    code: '',
    name: '',
    msg: '',
    busy: false,
  },

  async onLoad() {
    try {
      const member = await app.ensureMember();
      if (member) wx.reLaunch({ url: '/pages/index/index' });
    } catch (e) {
      this.setData({ msg: '身份核对失败，请检查网络后重试' });
    }
  },

  onCode(e) {
    this.setData({ code: e.detail.value.trim().toLowerCase(), msg: '' });
  },

  onName(e) {
    this.setData({ name: e.detail.value });
  },

  onJoin() {
    if (this.data.busy) return;
    const code = this.data.code.trim();
    if (code.length < 4) {
      this.setData({ msg: '码至少 4 位' });
      return;
    }
    this.submit('redeem', { code, name: this.data.name.trim() });
  },

  onCreate() {
    if (this.data.busy) return;
    const code = this.data.code.trim();
    if (code && (code.length < 4 || code.length > 12)) {
      this.setData({ msg: '家庭码用 4–12 位字母或数字' });
      return;
    }
    this.submit('create', { name: this.data.name.trim() || '我', code });
  },

  async submit(action, payload) {
    this.setData({ busy: true, msg: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'family',
        data: Object.assign({ action }, payload),
      });
      const r = (res && res.result) || {};

      if (!r.ok) {
        this.setData({ busy: false, msg: r.error || '没成功，再试一次' });
        return;
      }

      app.setMember(r.member);

      if (action === 'create') {
        wx.reLaunch({ url: '/pages/members/members?welcome=1' });
        return;
      }

      wx.reLaunch({ url: '/pages/index/index' });
    } catch (e) {
      const detail = (e && (e.errMsg || e.message)) || 'unknown';
      console.error('[family] callFunction failed:', detail, e);
      this.setData({ busy: false, msg: '连接失败：' + String(detail).slice(0, 46) });
    }
  },
});
