const config = require('./utils/config');
const dateUtil = require('./utils/date');

App({
  globalData: {
    member: null,
  },
  memberVersion: 0,
  ready: null,

  onLaunch() {
    if (!wx.cloud) {
      console.error('base lib too low, need 2.2.3+');
      return;
    }

    wx.cloud.init({
      env: config.envId,
      traceUser: true,
    });

    // 页面会等待同一个请求并显示错误；预加载失败不沿用旧角色。
    this.ensureMember().catch(() => {});
  },

  selectTab(page, active) {
    const bar = typeof page.getTabBar === 'function' && page.getTabBar();
    if (bar) bar.setData({ active });
  },

  openAssistant(prompt) {
    if (prompt) {
      const member = this.globalData.member;
      this.globalData.assistantPrompt = { text: prompt, memberId: member && member._id, familyCode: member && member.family_code };
    }
    wx.switchTab({ url: '/pages/assistant/assistant' });
  },

  ensureMember() {
    if (this.ready) return this.ready;
    const version = this.memberVersion;
    const pending = wx.cloud
      .callFunction({ name: 'family', data: { action: 'me' } })
      .then((res) => {
        if (version !== this.memberVersion) return this.globalData.member;
        const result = res && res.result;
        if (!result || !result.ok || !Object.prototype.hasOwnProperty.call(result, 'member')) {
          throw new Error((result && result.error) || '身份核对失败');
        }
        this.setMember(result.member);
        return result.member;
      })
      .finally(() => {
        if (this.ready === pending) this.ready = null;
      });
    this.ready = pending;
    return pending;
  },

  async getEntryCapabilities() {
    const res = await wx.cloud.callFunction({ name: 'entries', data: { action: 'capabilities' } });
    const r = res && res.result;
    if (r && r.ok === false && r.error === 'unknown action') {
      return { idempotentAdd: false, softDeleteOnly: false };
    }
    if (!r || !r.ok || typeof r.idempotentAdd !== 'boolean' || typeof r.softDeleteOnly !== 'boolean') {
      throw new Error((r && r.error) || '无法确认云函数能力，请重试');
    }
    return r;
  },

  async listEntries(data) {
    const res = await wx.cloud.callFunction({ name: 'entries', data });
    const result = res && res.result;
    // 云函数和客户端独立更新：仅旧服务明确不支持 list 时兼容 all。
    // 已有分页游标不能交给旧接口，以免把不同版本的数据混在一起。
    if (!result || result.ok !== false || result.error !== 'unknown action' || data.cursor) {
      return result;
    }
    const legacy = await wx.cloud.callFunction({ name: 'entries', data: { action: 'all' } });
    const r = legacy && legacy.result;
    if (!r || !r.ok) return r;
    if (!Array.isArray(r.list)) throw new Error('记录返回格式错误');
    // 旧接口最多返回 5000 条，触及上限时不能宣称已读完。
    if (r.limitReached || r.list.length >= 5000) {
      throw new Error('旧版云函数读取达到上限，请更新云函数后重试');
    }
    const list = data.month
      ? r.list.filter((entry) => typeof entry.happened_on === 'string' && entry.happened_on.slice(0, 7) === data.month)
      : r.list;
    return Object.assign({}, r, { list, nextCursor: null });
  },

  async requireRecordTools() {
    const capabilities = await this.getEntryCapabilities();
    if (capabilities.recordTools !== 1) throw new Error('此功能尚未启用，请联系管理员');
  },

  async getBabyProfile() {
    const res = await wx.cloud.callFunction({ name: 'family', data: { action: 'getProfile' } });
    const r = res && res.result;
    if (r && r.ok === false && r.error === 'unknown action') return { supported: false, profile: null };
    if (!r || !r.ok || !Object.prototype.hasOwnProperty.call(r, 'profile') || !r.member) {
      throw new Error((r && r.error) || '宝宝档案读取失败');
    }
    if (r.profile && (typeof r.profile.nickname !== 'string' || !r.profile.nickname.trim() || r.profile.nickname.length > 20
      || !dateUtil.validDate(r.profile.birthday) || r.profile.birthday > dateUtil.fmtDate(new Date())
      || !Number.isSafeInteger(r.profile.revision) || r.profile.revision < 0)) {
      throw new Error('宝宝档案格式异常，请联系管理员');
    }
    return { supported: true, profile: r.profile, member: r.member };
  },

  async collectEntries(query, familyCode, cancelled = () => false, onProgress = () => {}) {
    const rows = [], seen = new Set();
    let cursor = null;
    do {
      if (cancelled()) throw new Error('已取消读取');
      const r = await this.entryRequest(Object.assign({}, query, { action: 'list', cursor }));
      if (cancelled()) throw new Error('已取消读取');
      if (!Array.isArray(r.list) || !Object.prototype.hasOwnProperty.call(r, 'nextCursor')) throw new Error('记录返回格式错误');
      if (!r.member || r.member.family_code !== familyCode) throw new Error('家庭身份已变化，请重新打开页面');
      if (r.nextCursor && JSON.stringify(r.nextCursor) === JSON.stringify(cursor)) throw new Error('翻页位置没有更新');
      for (const row of r.list) {
        if (seen.has(row._id)) throw new Error('读取期间记录发生变化，请重试');
        seen.add(row._id); rows.push(row);
      }
      cursor = r.nextCursor;
      onProgress(rows.length);
      if (rows.length >= 10000 && cursor) throw new Error('记录较多，请缩小日期范围');
    } while (cursor);
    return rows;
  },

  async entryRequest(data) {
    const res = await wx.cloud.callFunction({ name: 'entries', data });
    const r = res && res.result;
    if (!r || !r.ok) {
      const err = new Error(r && r.error === 'unknown action' ? '此功能尚未启用，请联系管理员'
        : (r && r.error) || '请求失败，请重试');
      err.code = r && r.code;
      err.definite = !!r && r.ok === false;
      throw err;
    }
    return r;
  },

  setMember(member) {
    this.memberVersion += 1;
    this.globalData.member = member;
    if (member) wx.setStorageSync('member', member);
    else wx.removeStorageSync('member');
  },

  clearMember() {
    this.ready = null;
    this.setMember(null);
  },
});
