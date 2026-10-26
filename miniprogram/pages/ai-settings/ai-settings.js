const app = getApp();
const FIELDS = [
  { key: 'recognition', title: '记录识别', hint: '调整口语、相对时间和事件拆分的整理习惯。' },
  { key: 'cards', title: '动态卡片', hint: '调整类型命名、字段偏好和卡片表达。' },
  { key: 'assistant', title: '看板与智能助手', hint: '调整看板、追踪、补全、纠错和对比的关注点。' },
  { key: 'story', title: '成长故事', hint: '调整成长片段的语气、组织方式和篇幅偏好。' },
  { key: 'maintenance', title: '开发维护 Agent', hint: '下次开发任务进入本项目时，Agent 通过固定入口读取云端规则；无需导出文件。' },
];

Page({
  data: {
    fields: FIELDS, selected: 0, text: '', limit: 1500, ready: false, busy: false,
    values: {}, revision: 0, updated: '', history: [], dirty: false, pending: false, conflict: false, error: '',
  },

  onLoad() { return this.load(); },
  onUnload() { this.sequence = (this.sequence || 0) + 1; },

  showCurrent(current, history) {
    this.current = current;
    this.pending = null;
    const key = FIELDS[this.data.selected].key;
    this.setData({ values: Object.assign({}, current.values), revision: current.revision,
      text: current.values[key], limit: this.limits[key],
      updated: current.updated_at ? new Date(current.updated_at + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' 北京时间' : '默认规则',
      history: history.map((item) => ({ revision: item.revision, values: item.values })),
      ready: true, dirty: false, pending: false, conflict: false, error: '' });
  },

  async load() {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ busy: true, ready: false, error: '' });
    try {
      const member = await app.ensureMember();
      if (!member || member.role !== 'owner') throw new Error('只有家庭管理员能编辑 AI 规则');
      const capabilities = await app.getEntryCapabilities();
      if (capabilities.promptSettings !== 1) throw new Error('AI 规则尚未启用，需要先部署新版 entries 云函数');
      const r = await app.entryRequest({ action: 'getPromptSettings', familyCode: member.family_code });
      if (sequence !== this.sequence) return;
      if (!r.member || r.member._id !== member._id || r.member.family_code !== member.family_code || r.member.role !== 'owner') {
        throw new Error('家庭身份已变化，请重新打开页面');
      }
      this.member = r.member;
      this.defaults = r.defaults;
      this.limits = r.limits;
      this.showCurrent(r.current, r.history);
    } catch (err) { if (sequence === this.sequence) this.setData({ error: err.message }); }
    finally { if (sequence === this.sequence) this.setData({ busy: false }); }
  },

  reload() {
    if (this.data.busy) return;
    if (!this.data.dirty && !this.data.pending) return this.load();
    wx.showModal({ title: '重新读取云端规则？', content: '将用云端当前版本替换本页草稿。未保存内容会丢弃。',
      success: (r) => { if (r.confirm) this.load(); } });
  },

  selectField(e) {
    const selected = Number(e.detail.value);
    if (!FIELDS[selected] || !this.data.ready) return;
    const key = FIELDS[selected].key;
    this.setData({ selected, text: this.data.values[key], limit: this.limits[key] });
  },

  setDraft(values) {
    this.setData({ values, text: values[FIELDS[this.data.selected].key],
      dirty: FIELDS.some((field) => values[field.key] !== this.current.values[field.key]) });
  },

  onInput(e) {
    if (!this.data.ready || this.data.busy || this.data.pending) return;
    this.setDraft(Object.assign({}, this.data.values, { [FIELDS[this.data.selected].key]: e.detail.value }));
  },

  resetField() {
    if (!this.data.ready || this.data.busy || this.data.pending) return;
    const key = FIELDS[this.data.selected].key;
    this.setDraft(Object.assign({}, this.data.values, { [key]: this.defaults[key] }));
    wx.showToast({ title: '默认内容已放入草稿，保存后生效', icon: 'none' });
  },

  restoreVersion(e) {
    if (!this.data.ready || this.data.busy || this.data.pending) return;
    const item = this.data.history.find((row) => row.revision === Number(e.currentTarget.dataset.revision));
    if (!item) return;
    wx.showModal({ title: '载入版本 ' + item.revision + '？', content: '将替换本页所有规则草稿。可逐项检查，点击保存后才会在云端生效。',
      success: (r) => { if (r.confirm && !this.data.busy && !this.data.pending) this.setDraft(Object.assign({}, item.values)); } });
  },

  async save() {
    if (!this.data.ready || this.data.busy || this.data.conflict || !this.data.dirty && !this.data.pending) return;
    const sequence = this.sequence;
    this.setData({ busy: true, error: '' });
    try {
      const member = await app.ensureMember();
      if (sequence !== this.sequence) return;
      if (!member || member._id !== this.member._id || member.family_code !== this.member.family_code || member.role !== 'owner') {
        this.setData({ ready: false });
        throw new Error('家庭身份已变化，请重新打开页面');
      }
      if (!this.pending) this.pending = { action: 'savePromptSettings', familyCode: this.member.family_code,
        revision: this.current.revision, values: Object.assign({}, this.data.values) };
      this.setData({ pending: true });
      const r = await app.entryRequest(this.pending);
      if (sequence !== this.sequence) return;
      const history = r.current.revision === this.current.revision ? this.data.history
        : [this.current].concat(this.data.history).slice(0, 10);
      this.showCurrent(r.current, history);
      wx.showToast({ title: '规则已保存到云端', icon: 'none' });
    } catch (err) {
      if (sequence !== this.sequence) return;
      if (['CONFLICT', 'FORBIDDEN', 'VALIDATION'].includes(err.code)) {
        this.pending = null;
        this.setData({ pending: false, conflict: err.code === 'CONFLICT', ready: err.code !== 'FORBIDDEN' });
      }
      this.setData({ error: err.message + (this.pending ? '。结果未确认，请重试同一份规则或重新读取云端。' : '') });
    } finally { if (sequence === this.sequence) this.setData({ busy: false }); }
  },

  onBack() {
    if (this.data.busy) return;
    const leave = () => getCurrentPages().length > 1 ? wx.navigateBack() : wx.reLaunch({ url: '/pages/index/index' });
    if (!this.data.dirty && !this.data.pending) return leave();
    wx.showModal({ title: '离开规则编辑？', content: '未保存的草稿不会保留；保存结果不确定时请重新打开核对云端版本。',
      success: (r) => { if (r.confirm) leave(); } });
  },
});
