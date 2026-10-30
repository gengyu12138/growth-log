const app = getApp();
const helper = require('../../utils/assistant');
const { recordedTimeLabel } = require('../../utils/date');
Page({
  data: { request: '', answer: '', busy: false, saving: false, error: '', status: '', plan: null, report: null,
    chapters: [], storyTotal: 0, storyConsidered: 0, views: [], canEdit: false, selected: -1,
    sources: [], sourceTitle: '', sourceTotal: 0, pending: false, cloudViews: false, viewsLoading: false, viewStatus: '',
    tasks: ['回顾本月的重要变化', '整理学走路的过程', '对比这周和上周的记录', '持续关注辅食与反应'] },
  onLoad(options) { this.setData({ request: options.prompt || '' }); this.init(!!options.prompt); },
  onUnload() { this.version = (this.version || 0) + 1; this.disposed = true; },
  async init(generate) {
    try {
      const member = await app.ensureMember();
      if (!member) throw new Error('请先加入家庭');
      if (this.disposed) return;
      this.member = member;
      this.setData({ views: helper.readViews(wx, member), canEdit: ['owner', 'editor'].includes(member.role) });
      await this.reloadViews();
      if (generate) await this.generate();
    } catch (err) { if (!this.disposed) this.setData({ error: err.message }); }
  },
  onInput(e) {
    if (this.data.saving || this.data.pending) return;
    this.version = (this.version || 0) + 1; this.result = null;
    this.setData({ request: e.detail.value, answer: '', busy: false, plan: null, report: null, chapters: [], selected: -1, sources: [], sourceTitle: '', status: '', error: '' });
  },
  onAnswer(e) { if (!this.data.busy && !this.data.saving && !this.data.pending) this.setData({ answer: e.detail.value }); },
  async generate(event, saved) {
    if (this.data.busy || this.data.saving || this.data.pending) return;
    const request = this.data.request.trim(), answer = this.data.answer.trim();
    if (!saved && (!request || request.length > 500 || answer.length > 300)) { this.setData({ error: '请求最多500字，补充最多300字' }); return; }
    const version = this.version = (this.version || 0) + 1;
    const current = () => !this.disposed && this.version === version;
    this.result = null;
    this.setData({ busy: true, error: '', status: '', plan: null, report: null, chapters: [], selected: -1, sources: [], sourceTitle: '' });
    try {
      const member = await app.ensureMember(), caps = await app.getEntryCapabilities();
      if (!current()) return;
      if (!member || this.member && (member.family_code !== this.member.family_code || member._id !== this.member._id)) throw new Error('家庭身份已变化，请重新打开页面');
      if (caps.assistant !== 1) throw new Error('智能助手尚未启用，请联系管理员');
      this.member = member;
      this.setData({ canEdit: ['owner', 'editor'].includes(member.role) });
      const r = await app.entryRequest({ action: 'assistantPlan', request, answer, saved });
      if (!current()) return;
      if (!r.plan || !r.member || r.member.family_code !== member.family_code) throw new Error('助手返回异常');
      const plan = r.plan;
      this.setData({ plan, status: ['correct', 'clarify'].includes(plan.intent) ? '以下仅为建议，尚未修改任何记录' : '正在读取完整记录…' });
      if (['board', 'tracker', 'compare'].includes(plan.intent)) {
        const report = await helper.report(app, plan, member, () => !current());
        if (!current()) return;
        this.result = report;
        this.setData({ report: Object.assign({}, report, { rows: [], previousRows: [],
          metrics: report.metrics.map((m) => Object.assign({}, m, { sources: [], previousSources: [] })) }),
          status: '按当前筛选完整读取；统计由程序计算，未记录的数值不估算' });
      } else if (plan.intent === 'story') {
        const story = await app.entryRequest({ action: 'assistantStory', request, plan });
        if (!current()) return;
        if (!story.member || story.member.family_code !== member.family_code || !Array.isArray(story.chapters)) throw new Error('故事返回异常');
        this.setData({ chapters: story.chapters, storyTotal: story.total, storyConsidered: story.considered, status: '模型整理的专题片段；正文引用保留原文，可逐条核对' });
      }
    } catch (err) { if (current()) this.setData({ error: err.message, report: null, chapters: [], status: '' }); }
    finally { if (current()) this.setData({ busy: false }); }
  },
  openView(e) {
    const view = this.data.views[Number(e.currentTarget.dataset.index)];
    if (view) this.generate(null, view);
  },
  async reloadViews() {
    if (this.data.viewsLoading || this.data.busy || this.data.saving || this.data.pending) return;
    this.setData({ viewsLoading: true });
    try {
      const caps = await app.getEntryCapabilities();
      if (this.disposed) return;
      this.setData({ cloudViews: caps.cloudViews === 1 });
      if (caps.cloudViews !== 1) { this.setData({ viewStatus: '当前关注项仅保存在本机；云端同步需更新云函数' }); return; }
      const r = await app.entryRequest({ action: 'getViews' });
      if (this.disposed) return;
      if (!Array.isArray(r.views) || !Number.isSafeInteger(r.revision) || !r.member || r.member._id !== this.member._id || r.member.family_code !== this.member.family_code) throw new Error('关注项返回异常');
      this.viewsRevision = r.revision;
      const merged = helper.acceptCloudViews(wx, this.member, r);
      this.setData({ views: merged.views, viewStatus: merged.migration ? '已保留本机旧关注项，点击同步后可在其他设备使用' : '已读取云端关注项，按账号与家庭隔离' });
    } catch (err) { if (!this.disposed) this.setData({ viewStatus: '云端读取失败：' + err.message }); }
    finally { if (!this.disposed) this.setData({ viewsLoading: false }); }
  },
  async storeViews(views) {
    if (this.data.cloudViews) {
      if (!Number.isSafeInteger(this.viewsRevision)) throw new Error('请先重新读取云端关注项');
      const r = await app.entryRequest({ action: 'saveViews', views, revision: this.viewsRevision,
        memberId: this.member._id, familyCode: this.member.family_code });
      if (!Number.isSafeInteger(r.revision) || !Array.isArray(r.views)) throw new Error('云端保存结果异常，请重新读取核对');
      this.viewsRevision = r.revision; views = r.views;
      wx.setStorageSync(helper.storageKey(this.member) + ':revision', r.revision);
    }
    wx.setStorageSync(helper.storageKey(this.member), views);
    if (!this.disposed) this.setData({ views, viewStatus: this.data.cloudViews ? '已同步到云端，其他设备可读取' : '仅保存在本机，云端尚未启用同步' });
  },
  async saveView() {
    if (this.data.busy || this.data.saving || this.data.viewsLoading || this.data.error || !this.data.plan || !this.member) return;
    this.setData({ saving: true });
    try {
      const plan = this.data.plan;
      const view = { intent: plan.intent, title: plan.title, window: plan.window, types: plan.types, keywords: plan.keywords,
        fields: plan.fields, warning: '', question: '', candidates: [] };
      const views = this.data.views.slice();
      if (!views.some((v) => JSON.stringify(v) === JSON.stringify(view))) views.push(view);
      if (views.length > 20) throw new Error('最多保存20个关注项');
      await this.storeViews(views);
    } catch (err) { if (!this.disposed) this.setData({ viewStatus: err.message }); }
    finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  async syncViews() {
    if (this.data.busy || this.data.saving || this.data.pending || this.data.viewsLoading || !this.data.cloudViews) return;
    this.setData({ saving: true });
    try { await this.storeViews(this.data.views); }
    catch (err) { if (!this.disposed) this.setData({ viewStatus: err.message }); }
    finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  async removeView(e) {
    if (this.data.busy || this.data.saving || this.data.pending || this.data.viewsLoading) return;
    this.setData({ saving: true });
    try { await this.storeViews(this.data.views.filter((_, i) => i !== Number(e.currentTarget.dataset.index))); }
    catch (err) { if (!this.disposed) this.setData({ viewStatus: err.message }); }
    finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  chooseTask(e) {
    if (this.data.busy || this.data.saving || this.data.pending) return;
    this.onInput({ detail: { value: this.data.tasks[Number(e.currentTarget.dataset.index)] } }); this.generate();
  },
  selectCandidate(e) {
    if (this.data.busy || this.data.saving || this.data.pending || !this.data.plan) return;
    const index = Number(e.currentTarget.dataset.index);
    if (this.data.plan.candidates[index]) this.setData({ selected: index, error: '' });
  },
  async apply() {
    if (this.data.busy || this.data.saving || !this.data.canEdit || !this.data.plan) return;
    const candidate = this.pendingCandidate || this.data.plan.candidates[this.data.selected];
    if (!candidate) return;
    const version = this.version, family = this.member.family_code;
    this.setData({ saving: true, error: '' });
    try {
      const confirmed = await new Promise((resolve) => wx.showModal({ title: '确认修改这条记录？',
        content: candidate.before.date + ' ' + candidate.before.at + '\n修改前：' + candidate.before.content + '\n修改后：' + candidate.after.content
          + '\n新日期/时间：' + candidate.after.date + ' ' + (candidate.after.at || '原保存时间') + '\n计划：' + (candidate.after.planned ? '是' : '否')
          + '\n卡片数值以页面“修改后”预览为准。', confirmText: '确认修改', cancelText: '返回检查',
        success: (r) => resolve(r.confirm), fail: () => resolve(false) }));
      if (!confirmed || this.disposed || version !== this.version) return;
      const member = await app.ensureMember();
      if (!member || member.family_code !== family || member._id !== this.member._id || !['owner', 'editor'].includes(member.role)) throw new Error('身份或权限已变化，请重新打开页面');
      if (this.disposed || version !== this.version) return;
      const after = candidate.after;
      // 结果未确认时锁定原提案；重试仍发送同一版本和内容，不重新生成后覆盖。
      this.pendingCandidate = candidate; this.setData({ pending: true });
      const r = await wx.cloud.callFunction({ name: 'entries', data: { action: 'assistantApply', confirmed: true,
        id: candidate.id, revision: candidate.revision, content: after.content, happened_on: after.date, at: after.at,
        planned: after.planned, card: after.card, note: candidate.note, kind: candidate.kind } });
      if (!r.result || typeof r.result.ok !== 'boolean') throw new Error('保存结果待确认，请核对或重试');
      if (!r.result.ok) {
        this.pendingCandidate = null; this.setData({ pending: false, selected: -1 });
        throw new Error(r.result.error || '修改未成功，请重新生成');
      }
      this.pendingCandidate = null;
      if (!this.disposed) this.setData({ pending: false, plan: null, selected: -1, status: '已确认并保存修改', answer: '' });
    } catch (err) { if (!this.disposed) this.setData({ error: err.message || '修改失败，请重试' }); }
    finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  showSources(e) {
    if (this.data.busy || !this.result) return;
    const index = Number(e.currentTarget.dataset.index), previous = e.currentTarget.dataset.previous === true;
    const metric = this.result.metrics[index];
    this.sourceRows = metric ? (previous ? metric.previousSources : metric.sources)
      : (previous ? this.result.previousRows : this.result.rows).map((r) => ({ id: r._id, revision: r.revision || 0, date: r.happened_on, at: r.at || '',
        timeLabel: r.at || recordedTimeLabel(r.created_at), content: r.content }));
    this.setData({ sourceTitle: (previous ? '上一时段' : '当前时段') + ' · 原文依据', sources: this.sourceRows.slice(0, 30), sourceTotal: this.sourceRows.length });
  },
  moreSources() { this.setData({ sources: this.sourceRows.slice(0, this.data.sources.length + 30) }); },
  closeSources() { this.setData({ sources: [], sourceTitle: '' }); this.sourceRows = []; },
  openSource(e) {
    const { id, revision } = e.currentTarget.dataset;
    if (id) wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(id) + '&revision=' + revision });
  },
  preview(e) { wx.previewImage({ current: e.currentTarget.dataset.src, urls: e.currentTarget.dataset.images }); },
});
