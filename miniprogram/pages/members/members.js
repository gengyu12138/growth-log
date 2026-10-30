const app = getApp();

const ROLE_LABEL = { owner: '管理员', editor: '可写', viewer: '只读' };

Page({
  data: {
    showProfile: false, advanced: false,
    members: [],
    isOwner: false,
    myRoleLabel: '',
    inviteRole: 'viewer',
    invite: null,
    busy: false,
    msg: '',
    profileSupported: false,
    profileBusy: false,
    profileError: '',
    nickname: '',
    birthday: '',
    today: '',
  },

  toggleProfile() { this.setData({ showProfile: !this.data.showProfile }); },
  toggleAdvanced() { this.setData({ advanced: !this.data.advanced }); },
  goLibrary() { wx.navigateTo({ url: '/pages/library/library' }); },
  onShow() {
    app.selectTab(this, 'members');
    if (!this.data.busy && !this.data.profileBusy) this.load();
  },

  openAiSettings() {
    if (this.data.isOwner) wx.navigateTo({ url: '/pages/ai-settings/ai-settings' });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: '/pages/index/index' });
  },

  async load() {
    const id = this.loadId = (this.loadId || 0) + 1;
    this.setData({ msg: '' });
    try {
      const member = await app.ensureMember();
      if (id !== this.loadId) return;
      if (!member) {
        wx.reLaunch({ url: '/pages/join/join' });
        return;
      }
      if (this.member && (this.member._id !== member._id || this.member.family_code !== member.family_code)) {
        this.profile = null; this.profileDirty = false;
        this.setData({ members: [], isOwner: false, invite: null, profileSupported: false, nickname: '', birthday: '' });
      }
      this.member = member;
      const res = await wx.cloud.callFunction({
        name: 'family',
        data: { action: 'listMembers' },
      });
      if (id !== this.loadId) return;
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.error || 'fail');

      const list = (r.list || []).map((m) => Object.assign({}, m, {
        initial: String(m.name || '家').slice(0, 1),
        roleLabel: ROLE_LABEL[m.role] || '成员',
        isMe: m._id === r.meId,
      }));
      const me = list.find((m) => m.isMe);
      if (!me) throw new Error('成员身份已变化');
      app.setMember(me);

      this.setData({
        members: list,
        isOwner: me.role === 'owner',
        myRoleLabel: ROLE_LABEL[me.role] || '成员',
      });
      if (!this.profileDirty && !this.data.profileBusy) await this.loadProfile(id, me.family_code, !!this.profile);
    } catch (e) {
      if (id !== this.loadId) return;
      this.setData({ msg: '成员列表没拉下来，请点此重试' });
    }
  },

  onUnload() {
    this.loadId = (this.loadId || 0) + 1;
  },

  async loadProfile(id = this.loadId, familyCode, quiet = false) {
    this.setData({ profileError: '', today: require('../../utils/date').fmtDate(new Date()) });
    if (!quiet) this.setData({ profileBusy: true });
    try {
      const r = await app.getBabyProfile();
      if (id !== this.loadId) return;
      if (!r.supported) { this.setData({ profileSupported: false, profileError: '宝宝档案尚未启用，请联系管理员' }); return; }
      if (familyCode && r.member.family_code !== familyCode) throw new Error('家庭身份已变化，请重新打开页面');
      if (quiet && this.profileDirty) return;
      this.profile = r.profile;
      this.profileDirty = false;
      this.setData({ profileSupported: true, nickname: r.profile ? r.profile.nickname : '',
        birthday: r.profile ? r.profile.birthday : '' });
    } catch (err) { if (id === this.loadId) this.setData({ profileError: err.message }); }
    finally { if (!quiet && id === this.loadId) this.setData({ profileBusy: false }); }
  },

  onNickname(e) { if (!this.data.profileBusy && this.data.isOwner) { this.profileDirty = true; this.setData({ nickname: e.detail.value }); } },
  onBirthday(e) { if (!this.data.profileBusy && this.data.isOwner) { this.profileDirty = true; this.setData({ birthday: e.detail.value }); } },
  reloadProfile() {
    if (this.data.profileBusy) return;
    if (!this.profileDirty) return this.loadProfile();
    wx.showModal({ title: '重新读取档案？', content: '未保存的昵称和生日将被替换。', success: (r) => { if (r.confirm) this.loadProfile(); } });
  },

  async saveProfile() {
    if (this.data.profileBusy || this.data.busy || !this.data.isOwner || !this.data.profileSupported) return;
    const id = this.loadId;
    this.setData({ profileBusy: true, profileError: '' });
    try {
      const res = await wx.cloud.callFunction({ name: 'family', data: { action: 'saveProfile',
        nickname: this.data.nickname, birthday: this.data.birthday, revision: this.profile ? this.profile.revision : 0 } });
      const r = res && res.result;
      if (id !== this.loadId) return;
      if (!r || !r.ok || !r.profile) throw new Error(r && r.error || '档案保存失败，请重试');
      this.profile = r.profile;
      this.profileDirty = false;
      this.setData({ nickname: r.profile.nickname, birthday: r.profile.birthday });
      wx.showToast({ title: '宝宝档案已保存', icon: 'none' });
    } catch (err) { if (id === this.loadId) this.setData({ profileError: err.message }); }
    finally { if (id === this.loadId) this.setData({ profileBusy: false }); }
  },

  onPickRole(e) {
    if (this.data.busy) return;
    this.setData({ inviteRole: e.currentTarget.dataset.role });
  },

  async onCreateInvite() {
    if (this.data.busy || !this.data.isOwner) return;
    const id = this.loadId;
    this.setData({ busy: true, msg: '', invite: null });

    try {
      const res = await wx.cloud.callFunction({
        name: 'family',
        data: { action: 'createInvite', role: this.data.inviteRole },
      });
      const r = (res && res.result) || {};
      if (id !== this.loadId) return;
      if (!r.ok) throw new Error(r.error || 'fail');

      this.setData({ invite: r.invite });
    } catch (e) {
      if (id === this.loadId) this.setData({ msg: '没生成成功，再试一次' });
    } finally {
      this.setData({ busy: false });
    }
  },

  onCopy() {
    const invite = this.data.invite;
    if (!invite) return;
    wx.setClipboardData({ data: invite.code });
  },

  onMemberTap(e) {
    const { id, name, role } = e.currentTarget.dataset;
    if (!this.data.isOwner || this.data.busy) return;

    const isMe = this.data.members.some((m) => m._id === id && m.isMe);
    if (isMe) return;

    const nextRole = role === 'viewer' ? 'editor' : 'viewer';
    const nextLabel = ROLE_LABEL[nextRole];

    wx.showActionSheet({
      itemList: [`改为${nextLabel}`, '移出家庭'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.call('setRole', { id, role: nextRole }, `已把${name}改为${nextLabel}`);
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: `移出 ${name}？`,
            content: '对方会回到「未被邀请」状态，记录不会丢',
            confirmText: '移出',
            confirmColor: '#d97a6c',
            success: (m) => {
              if (m.confirm) this.call('removeMember', { id }, `已移出 ${name}`);
            },
          });
        }
      },
    });
  },

  async call(action, payload, okText) {
    if (this.data.busy || !this.data.isOwner) return;
    this.setData({ busy: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'family',
        data: Object.assign({ action }, payload),
      });
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.error || 'fail');

      wx.showToast({ title: okText, icon: 'none' });
      await this.load();
    } catch (e) {
      wx.showToast({ title: '没成功', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },
});
