const dateUtil = require('../../utils/date');
const { editField, clearInterval } = require('../../utils/cards');
const { readViews, acceptCloudViews } = require('../../utils/assistant');
const { createVoice } = require('../../utils/voice');
const outbox = require('../../utils/outbox');
const review = require('../../utils/review');

const app = getApp();

const KIND_LABEL = { daily: '日常', first: '第一次', health: '健康' };
const KIND_SEAL = { daily: '日', first: '初', health: '康' };
const KINDS = [
  { key: 'daily', label: '日常' },
  { key: 'first', label: '第一次' },
  { key: 'health', label: '健康' },
];

Page({
  data: {
    monthTitle: '',
    cells: [],
    selectedDate: '',
    dayLabel: '',
    dayCountText: '',
    dayEntries: [],
    stats: '',
    kinds: KINDS,
    kind: 'daily',
    text: '',
    draftDate: '', draftBaseDate: '',
    draftStatus: '',
    draftAt: '', dateManual: false, timeManual: false, planned: false, planManual: false,
    recognizing: false, recognitionStatus: '', recognitionWarning: '', analysisEvents: [], newTypes: [], newTypesLabel: '', knownTypes: [], assistantIntent: '',
    images: [],
    busy: false,
    pickingImages: false,
    savePending: false,
    saveRetrySafe: false,
    kbHeight: 0,
    canEdit: false,
    loading: true, refreshing: false,
    hasMore: false,
    loadError: '',
    monthAnim: '',
    today: '',
    viewMode: 'timeline',
    composerOpen: true, inputMode: 'voice', localMode: false, offline: false, syncing: false, queueCount: 0, queueError: '', duplicateCandidates: [], kindManual: false, advanced: false, editingCardIndex: -1, showPlans: false, recording: false, voiceSeconds: 0, transcribing: false, voiceStatus: '', voiceRetry: false, voiceStarting: false,
    timeline: [],
    statusBar: 20,
    barHeight: 44,
    navTotal: 64,
    babyLabel: '',
    profileError: '',
  },

  onLoad(options) {
    this.disposed = false;
    this.networkHandler = (r) => { this.setData({ offline: !r.isConnected }); if (r.isConnected) this.init(); };
    wx.onNetworkStatusChange(this.networkHandler);
    wx.getNetworkType({ success: (r) => { if (!this.disposed) this.setData({ offline: r.networkType === 'none' }); } });
    this.voice = createVoice(this, async (text) => {
      const combined = [this.data.text.trim(), text].filter(Boolean).join('\n');
      this.onText({ detail: { value: combined } });
      if (combined.length <= 500) await this.recognize();
    });
    let statusBar = 20;
    let barHeight = 44;
    try {
      const win = wx.getWindowInfo();
      statusBar = win.statusBarHeight || 20;
      const rect = wx.getMenuButtonBoundingClientRect();
      if (rect && rect.height) barHeight = (rect.top - statusBar) * 2 + rect.height;
    } catch (e) {
      // 取不到用默认值
    }
    this.setData({ statusBar, barHeight, navTotal: statusBar + barHeight });

    const initial = (options && options.date) || dateUtil.fmtDate(new Date());
    this.month = dateUtil.startOfMonth(dateUtil.parseDate(initial));
    this.all = [];
    this.setData({
      selectedDate: initial,
      today: dateUtil.fmtDate(new Date()),
    });

    // 键盘高度用官方事件拿，比 focus 回调里的 detail.height 稳
    this.kbHandler = (res) => {
      const h = (res && res.height) || 0;
      if (h !== this.data.kbHeight) this.setData({ kbHeight: h });
    };
    wx.onKeyboardHeightChange(this.kbHandler);
  },

  onUnload() {
    this.disposed = true;
    if (this.voice) this.voice.dispose();
    if (this.networkHandler) wx.offNetworkStatusChange(this.networkHandler);
    this.analysisVersion = (this.analysisVersion || 0) + 1;
    this.persistDraft();
    this.initId = (this.initId || 0) + 1;
    this.reloadId = (this.reloadId || 0) + 1;
    clearTimeout(this.flipTimer);
    if (this.kbHandler) wx.offKeyboardHeightChange(this.kbHandler);
  },

  onHide() {
    if ((this.data.recording || this.data.voiceStarting) && this.voice) this.voice.cancel();
    this.persistDraft();
  },

  onShow() {
    app.selectTab(this, 'records');
    if (this.member && (this.data.busy || this.data.savePending)) return;
    const today = dateUtil.fmtDate(new Date());
    if (today !== this.data.today) this.setData({ today });
    this.init();
  },

  async init() {
    const id = this.initId = (this.initId || 0) + 1;
    try {
      const member = await app.ensureMember();
      if (id !== this.initId) return;
      if (!member) {
        wx.reLaunch({ url: '/pages/join/join' });
        return;
      }
      const firstLoad = !this.member || this.member._id !== member._id || this.member.family_code !== member.family_code;
      this.identityFailed = false;
      this.member = member;
      this.pendingKey = 'pendingEntry:' + member._id;
      this.draftKey = 'entryDraft:' + member._id + ':' + member.family_code;
      const pending = wx.getStorageSync(this.pendingKey);
      try { if (pending && pending.familyCode === member.family_code) outbox.importPending(member, pending); }
      catch (err) { this.setData({ queueError: err.message }); }
      this.pendingSave = null;
      const patch = { canEdit: member.role === 'owner' || member.role === 'editor', localMode: false, savePending: false, saveRetrySafe: false };
      if (firstLoad) { this.resetRecognition(); this.aiStates = {}; this.all = []; this.cursor = null; this.loaded = false; this.profile = null; }
      if (firstLoad) Object.assign(patch, { viewMode: 'timeline', text: '', images: [], kind: 'daily', draftDate: '', draftBaseDate: '', draftStatus: '', draftAt: '', dateManual: false, timeManual: false, planned: false, planManual: false });
      if (firstLoad) {
        const draft = wx.getStorageSync(this.draftKey);
        if (draft && typeof draft.text === 'string' && Array.isArray(draft.images)) {
          const images = draft.images.filter((path) => {
            try { if (path.startsWith('cloud://')) return true; wx.getFileSystemManager().accessSync(path); return true; } catch (e) { return false; }
          });
          if (Array.isArray(draft.proposals) && draft.proposals.length > 0 && draft.proposals.length <= 5
            && draft.proposals.every((item) => item && typeof item.content === 'string' && item.content.trim()
              && draft.text.includes(item.content) && dateUtil.validDate(item.date)
              && (item.at === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(item.at)) && typeof item.planned === 'boolean')) {
            patch.analysisEvents = draft.proposals;
            patch.newTypes = Array.isArray(draft.newTypes) ? draft.newTypes : [];
            patch.newTypesLabel = patch.newTypes.join('、');
            patch.knownTypes = Array.isArray(draft.knownTypes) ? draft.knownTypes : [];
            patch.recognitionStatus = '已恢复手动调整的拆分草稿，请检查后保存';
            this.analysisText = draft.text.trim(); this.analyzedAt = Date.now(); this.proposalEdited = true;
          }
          Object.assign(patch, { text: draft.text, images, kind: draft.kind, composerOpen: true,
            kindManual: draft.kindManual === true,
            draftDate: draft.date, draftBaseDate: draft.baseDate || draft.date, draftAt: draft.at || '', dateManual: draft.dateManual === true,
            timeManual: draft.timeManual === true, planned: draft.planned === true, planManual: draft.planManual === true, draftStatus: images.length === draft.images.length
              ? '已恢复本机草稿' : '已恢复文字，部分图片已失效，请重新选择' });
          this.sourceOutboxId = draft.sourceOutboxId || '';
        }
      }
      this.setData(patch);
      try { this.applyIncomingDraft(); } catch (err) { this.setData({ queueError: err.message }); }
      this.refreshQueue(); this.syncOutbox();
      await Promise.all([this.reload(false, !firstLoad), this.loadProfile(id)]);
    } catch (e) {
      if (id === this.initId) {
        this.identityFailed = true;
        const cached = app.getLocalMember();
        if (cached && ['owner', 'editor'].includes(cached.role)) {
          if (!this.member || this.member._id !== cached._id || this.member.family_code !== cached.family_code) {
            this.resetRecognition(); this.all = []; this.loaded = false; this.sourceOutboxId = '';
            this.setData({ text: '', images: [], timeline: [], dayEntries: [], babyLabel: '', kindManual: false });
          }
          this.member = cached; this.draftKey = 'entryDraft:' + cached._id + ':' + cached.family_code;
          this.pendingKey = 'pendingEntry:' + cached._id;
          const draft = wx.getStorageSync(this.draftKey);
          if (!this.data.text && draft && typeof draft.text === 'string' && Array.isArray(draft.images)) this.setData({ text: draft.text, images: draft.images, draftDate: draft.date, draftBaseDate: draft.baseDate || draft.date, kind: draft.kind || 'daily' });
          this.setData({ canEdit: false, localMode: true, loading: false, refreshing: false, loadError: '暂时无法核对在线身份，可先存本机，联网后再同步' });
          try { this.applyIncomingDraft(); } catch (err) { this.setData({ queueError: err.message }); }
          this.refreshQueue();
        } else this.setData({ canEdit: false, loading: false, refreshing: false, loadError: '身份核对失败，请重试' });
      }
    }
  },

  async loadProfile(id = this.initId) {
    this.setData({ profileError: '' });
    if (!this.profile) this.setData({ babyLabel: '' });
    try {
      const r = await app.getBabyProfile();
      if (id !== this.initId) return;
      if (r.supported && r.member.family_code !== this.member.family_code) throw new Error('家庭身份已变化');
      this.profile = r.profile;
      this.setData({ babyLabel: r.profile ? r.profile.nickname + ' · ' + dateUtil.ageLabel(r.profile.birthday, this.data.today) : '' });
      this.render();
    } catch (err) {
      if (id === this.initId) this.setData({ profileError: '月龄暂未读取，点此重试' });
    }
  },

  retryProfile() { return this.loadProfile(); },

  async reload(append = false, quiet = false) {
    if (append && (this.data.loading || this.data.refreshing || !this.cursor)) return;
    const id = this.reloadId = (this.reloadId || 0) + 1;
    const identityCheck = this.initId;
    const isCalendar = this.data.viewMode === 'calendar';
    const month = dateUtil.fmtDate(this.month).slice(0, 7);
    const background = quiet && this.loaded === true;
    this.refreshFailed = false;
    const previousCount = this.all.length;
    let rows = append ? this.all.slice() : [];
    let cursor = append ? this.cursor : null;
    if (!append && !background) { this.all = []; this.cursor = null; }
    this.setData({ loading: !background, refreshing: background, loadError: '' });
    if (!background) this.render();
    try {
      do {
        const data = { action: 'list', cursor };
        if (isCalendar) data.month = month;
        const result = await app.listEntries(data);
        if (id !== this.reloadId || identityCheck !== this.initId) return;
        const r = result || {};
        if (!r.ok) {
          if (r.error && r.error.indexOf('加入家庭') >= 0) {
            app.clearMember();
            wx.reLaunch({ url: '/pages/join/join' });
            return;
          }
          throw new Error(r.error || 'fail');
        }
        if (!Array.isArray(r.list) || !Object.prototype.hasOwnProperty.call(r, 'nextCursor')) {
          throw new Error('记录返回格式错误');
        }
        if (r.nextCursor && JSON.stringify(r.nextCursor) === JSON.stringify(cursor)) {
          throw new Error('翻页位置没有更新');
        }
        if (r.member) {
          this.member = r.member;
          app.setMember(r.member);
          this.setData({ canEdit: r.member.role === 'owner' || r.member.role === 'editor' });
        }

        const existing = new Set(rows.map((e) => e._id));
        rows = rows.concat(r.list.filter((e) => !existing.has(e._id)).map((e) => {
          const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(e.at || '') ? e.at : '';
          return Object.assign({}, e, {
            images: e.images || [],
            tags: e.tags || [],
            place: e.place || '',
            note: e.note || '',
            at,
            timeLabel: dateUtil.entryTime(e),
            recordedLabel: at ? '' : dateUtil.recordedTimeLabel(e.created_at),
            fromText: Boolean(at),
            temp: typeof e.temp === 'number' ? e.temp : null,
            meds: e.meds || [],
            kindLabel: KIND_LABEL[e.kind] || '日常',
            seal: KIND_SEAL[e.kind] || '日',
          });
        }));
        cursor = r.nextCursor;
        if (!background) { this.all = rows; this.cursor = cursor; this.setData({ hasMore: Boolean(cursor) }); this.render(); }
      } while (cursor && (isCalendar || background && rows.length < previousCount));
      this.all = rows; this.cursor = cursor; this.loaded = true;
      this.setData({ hasMore: Boolean(cursor) });
    } catch (err) {
      if (id !== this.reloadId || identityCheck !== this.initId) return;
      this.refreshFailed = background;
      this.setData({ loadError: '记录未读取完成，请重试' });
    }
    if (id !== this.reloadId || identityCheck !== this.initId) return;
    this.setData({ loading: false, refreshing: false });
    this.render();
  },

  onLoadMore() {
    return this.reload(true);
  },

  onRetry() {
    if (this.identityFailed) return this.init();
    if (this.refreshFailed) return this.reload(false, true);
    return this.reload(Boolean(this.cursor));
  },

  render() {
    const monthKey = `${this.month.getFullYear()}-${dateUtil.pad(this.month.getMonth() + 1)}`;
    const counts = {};
    let monthCount = 0;

    const visibleRows = this.all.filter((e) => this.data.showPlans ? e.planned === true : !e.planned);
    for (const e of visibleRows) {
      if (e.happened_on && e.happened_on.slice(0, 7) === monthKey) {
        counts[e.happened_on] = (counts[e.happened_on] || 0) + 1;
        monthCount += 1;
      }
    }

    const cells = dateUtil.buildCalendar(this.month).map((c) => (
      c ? { day: c.day, date: c.date, count: counts[c.date] || 0 } : null
    ));

    const entries = visibleRows.map((e) => Object.assign({}, e, {
      aiLabel: e.manually_edited ? '' : this.aiStates && Object.prototype.hasOwnProperty.call(this.aiStates, e._id) ? this.aiStates[e._id] : (e.ai_status === 'pending' ? '已保存 · 标签待整理，点此重试' : ''),
      ageLabel: this.profile ? dateUtil.ageLabel(this.profile.birthday, e.happened_on) : '',
    }));
    const byEventTime = (a, b) => b.timeLabel.localeCompare(a.timeLabel)
      || b.created_at - a.created_at || String(b._id).localeCompare(String(a._id));
    const dayEntries = this.data.viewMode === 'calendar' ? entries
      .filter((e) => e.happened_on === this.data.selectedDate)
      .sort(byEventTime) : [];

    const total = visibleRows.length;

    // 时间轴：按日期倒序分组，只保留有记录的日子
    const bucket = {};
    const timeline = [];
    for (const e of this.data.viewMode === 'timeline' ? entries : []) {
      if (!e.happened_on) continue;
      if (!bucket[e.happened_on]) {
        bucket[e.happened_on] = {
          date: e.happened_on,
          label: dateUtil.fmtDayHead(e.happened_on),
          entries: [],
        };
        timeline.push(bucket[e.happened_on]);
      }
      bucket[e.happened_on].entries.push(e);
    }
    timeline.sort((a, b) => (a.date < b.date ? 1 : -1));
    timeline.forEach((g) => {
      g.entries.sort(byEventTime);
    });

    this.setData({
      timeline,
      monthTitle: dateUtil.monthTitle(this.month),
      cells,
      dayEntries,
      dayLabel: dateUtil.fmtDayHead(this.data.selectedDate),
      dayCountText: dayEntries.length ? `${dayEntries.length} 条` : '',
      stats: this.data.viewMode === 'calendar'
        ? `本月${this.data.loading || this.data.loadError ? '已加载' : ''} ${monthCount} 条`
        : `${this.data.hasMore || this.data.loading || this.data.loadError ? '已加载' : '共'} ${total} 条`,
    });
  },

  prevMonth() {
    this.month = dateUtil.addMonths(this.month, -1);
    this.flipMonth('right');
  },

  nextMonth() {
    this.month = dateUtil.addMonths(this.month, 1);
    this.flipMonth('left');
  },

  flipMonth(dir) {
    clearTimeout(this.flipTimer);
    const monthKey = dateUtil.fmtDate(this.month).slice(0, 7);
    const selectedDate = this.data.selectedDate.slice(0, 7) === monthKey
      ? this.data.selectedDate : monthKey + '-01';
    this.setData({ selectedDate });
    this.setData({ monthAnim: '' }, () => {
      this.render();
      this.setData({ monthAnim: `flip-${dir}` });
      this.flipTimer = setTimeout(() => this.setData({ monthAnim: '' }), 340);
    });
    if (this.data.viewMode === 'calendar') this.reload();
  },

  onSwitchView(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.viewMode) return;
    this.setData({ viewMode: mode });
    this.render();
    this.reload(false, true);
  },

  onPickDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({ selectedDate: date }, () => this.render());
  },

  startVoice() { if (!this.data.busy && !this.data.savePending && !this.data.voiceStarting) this.voice.start(); },
  stopVoice() { this.voice.stop(); },
  cancelVoice() { this.voice.cancel(); },
  retryVoice() { if (!this.data.busy && !this.data.savePending && !this.data.recording && !this.data.voiceStarting && this.data.canEdit) this.voice.retry(); },
  voiceSettings() { wx.openSetting({ success: (r) => { if (!this.disposed) this.setData({ voicePermissionDenied: !r.authSetting['scope.record'], voiceStatus: r.authSetting['scope.record'] ? '已允许麦克风，点击说话开始录音' : '可切换键盘继续输入' }); } }); },
  openComposer(e) {
    if ((!this.data.canEdit && !this.data.localMode) || this.data.busy) return;
    const date = e && e.currentTarget.dataset.date;
    const patch = { composerOpen: true };
    if (!this.data.text && !this.data.images.length && !this.data.savePending) {
      Object.assign(patch, { draftDate: date || this.data.today, draftBaseDate: date || this.data.today, dateManual: !!date });
    }
    this.setData(patch);
  },
  toggleAdvanced() { this.setData({ advanced: !this.data.advanced }); },
  toggleCardEditor(e) { const index = Number(e.currentTarget.dataset.index); this.setData({ editingCardIndex: this.data.editingCardIndex === index ? -1 : index }); },
  togglePlans() { this.setData({ showPlans: !this.data.showPlans }, () => this.render()); },
  goToday() {
    this.month = dateUtil.startOfMonth(new Date());
    this.setData({ selectedDate: this.data.today }); this.reload();
  },
  goPhotos() { wx.navigateTo({ url: '/pages/photos/photos' }); },

  onKind(e) {
    if (this.data.busy || this.data.savePending || (!this.data.canEdit && !this.data.localMode)) return;
    this.setData({ kind: e.currentTarget.dataset.kind, kindManual: true });
    this.persistDraft();
  },

  onKbHeight(e) {
    const h = (e && e.detail && e.detail.height) || 0;
    if (h !== this.data.kbHeight) this.setData({ kbHeight: h });
  },

  onKbFocus() {
    // 键盘高度统一由 onKeyboardHeightChange 提供，这里只负责兜底
  },

  onKbBlur() {
    if (this.data.kbHeight) this.setData({ kbHeight: 0 });
    if (!this.data.busy && !this.data.savePending) this.recognize();
  },

  onText(e) {
    if (this.data.busy || this.data.savePending) return;
    const baseDate = this.data.draftBaseDate || this.data.draftDate || this.data.today;
    this.resetRecognition();
    this.setData({ text: e.detail.value, draftBaseDate: baseDate,
      draftDate: this.data.dateManual ? this.data.draftDate : baseDate,
      draftAt: this.data.timeManual ? this.data.draftAt : '',
      planned: this.data.planManual ? this.data.planned : false });
    this.persistDraft();
  },

  onDraftDate(e) {
    if (this.data.busy || this.data.savePending) return;
    this.setData({ draftDate: e.detail.value, draftBaseDate: e.detail.value, dateManual: true });
    this.resetRecognition();
    this.persistDraft();
  },

  resetRecognition() {
    this.analysisVersion = (this.analysisVersion || 0) + 1;
    this.analysisTask = null;
    this.analysisText = '';
    this.proposalEdited = false;
    this.duplicateAck = '';
    this.setData({ duplicateCandidates: [], pendingDuplicate: false, clarificationQuestion: '', clarificationAnswer: '', recognizing: false, recognitionStatus: '', recognitionWarning: '', analysisEvents: [], newTypes: [], newTypesLabel: '', assistantIntent: '' });
  },

  onDraftTime(e) {
    if (this.data.busy || this.data.savePending) return;
    this.setData({ draftAt: e.detail.value, timeManual: true,
      analysisEvents: this.data.analysisEvents.map((item) => Object.assign({}, item, { at: e.detail.value, card: clearInterval(item.card) })) });
    this.persistDraft();
  },

  onUseCurrentTime() {
    if (this.data.busy || this.data.savePending) return;
    this.setData({ draftAt: '', timeManual: true,
      analysisEvents: this.data.analysisEvents.map((item) => Object.assign({}, item, { at: '', card: clearInterval(item.card) })) }); this.persistDraft();
  },

  onPlanned(e) {
    if (this.data.busy || this.data.savePending) return;
    this.setData({ planned: e.detail.value, planManual: true,
      analysisEvents: this.data.analysisEvents.map((item) => Object.assign({}, item, { planned: e.detail.value })) }); this.persistDraft();
  },

  onProposal(e) {
    if (this.data.busy || this.data.savePending) return;
    const { index, field } = e.currentTarget.dataset;
    if (!['date', 'at', 'planned'].includes(field)) return;
    const events = this.data.analysisEvents.map((item, i) => i === Number(index)
      ? Object.assign({}, item, { [field]: e.detail.value, card: field === 'planned' ? item.card : clearInterval(item.card) }) : item);
    this.proposalEdited = true;
    this.setData({ analysisEvents: events });
    this.persistDraft();
  },

  updateDraftCard(e, update) {
    if (this.data.busy || this.data.savePending) return;
    const index = Number(e.currentTarget.dataset.index);
    const events = this.data.analysisEvents.map((item, i) => i === index && item.card
      ? Object.assign({}, item, { card: update(item.card) }) : item);
    const newTypes = [...new Set(events.filter((item) => item.card && item.card.type && !this.data.knownTypes.includes(item.card.type)).map((item) => item.card.type))];
    this.proposalEdited = true;
    this.setData({ analysisEvents: events, newTypes, newTypesLabel: newTypes.join('、') });
    this.persistDraft();
  },

  onCardType(e) { this.updateDraftCard(e, (card) => Object.assign({}, card, { type: e.detail.value.trim() })); },
  onCardField(e) { this.updateDraftCard(e, (card) => editField(card, e.detail.index, e.detail.value, e.detail.remove)); },
  onCardUnlink(e) { this.updateDraftCard(e, (card) => Object.assign({}, card, { related: card.related.filter((_, i) => i !== e.detail.index) })); },
  onRemoveCard(e) { this.updateDraftCard(e, () => null); },

  clearProposalTime(e) {
    this.onProposal({ currentTarget: { dataset: { index: e.currentTarget.dataset.index, field: 'at' } }, detail: { value: '' } });
  },

  retryRecognition() {
    if (this.data.busy || this.data.savePending || this.data.recognizing) return;
    this.resetRecognition(); return this.recognize();
  },

  onClarification(e) { if (!this.data.busy) this.setData({ clarificationAnswer: e.detail.value }); },
  async addClarification() {
    if (this.data.busy || this.data.recognizing) return;
    const answer = (this.data.clarificationAnswer || '').trim();
    if (!answer) return;
    const text = this.data.text + '\n补充确认：' + answer;
    if (text.length > 500) { wx.showToast({ title: '补充后超过500字，请先精简原文', icon: 'none' }); return; }
    this.onText({ detail: { value: text } }); await this.recognize();
  },

  async recognize() {
    const text = this.data.text.trim();
    if (!text || this.data.text.length > 500 || !this.data.canEdit || this.data.savePending) return false;
    if (this.analysisText === text && (this.proposalEdited || Date.now() - this.analyzedAt < 120000)) return true;
    if (this.analysisTask) return this.analysisTask;
    const version = this.analysisVersion || 0;
    const family = this.member && this.member.family_code;
    const date = this.data.dateManual ? this.data.draftDate : this.data.draftBaseDate || this.data.draftDate || this.data.selectedDate;
    const current = () => version === (this.analysisVersion || 0) && text === this.data.text.trim()
      && this.member && family === this.member.family_code;
    this.setData({ recognizing: true, recognitionStatus: '正在识别日期、时间和事件…' });
    const task = (async () => {
      try {
        const caps = await app.getEntryCapabilities();
        if (caps.smartInput !== 1) throw new Error('智能识别尚未启用，请手动检查');
        let views = readViews(wx, this.member);
        if (caps.cloudViews === 1) {
          const saved = await app.entryRequest({ action: 'getViews' });
          if (!current()) return false;
          views = acceptCloudViews(wx, this.member, saved).views;
        }
        const r = await app.entryRequest({ action: 'analyze', content: text, selectedDate: date, cards: caps.dynamicCards === 1 ? 1 : undefined,
          assistant: caps.assistant === 1 ? 1 : undefined, trackers: caps.assistant === 1 ? views.filter((v) => v.intent === 'tracker') : undefined });
        if (!current()) return false;
        if (r.assistantIntent && r.assistantIntent !== 'record') {
          this.setData({ assistantIntent: r.assistantIntent, analysisEvents: [], recognitionStatus: '这是助手请求，请打开智能助手检查结果', recognitionWarning: '' });
          return false;
        }
        if (!Array.isArray(r.events) || !r.events.length || r.events.length > 5 || typeof r.warning !== 'string'
          || r.events.some((item) => !item || typeof item.content !== 'string' || !text.includes(item.content)
            || item.date !== null && !dateUtil.validDate(item.date)
            || item.at !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.at)
            || typeof item.planned !== 'boolean')) throw new Error('识别结果异常，请手动检查');
        const warnings = [r.warning];
        const events = r.events.map((item) => {
          if (this.data.dateManual && item.date && item.date !== this.data.draftDate) {
            warnings.push('原文识别日期为' + item.date + '，将保留手选日期' + this.data.draftDate);
          }
          return { content: item.content, date: this.data.dateManual ? this.data.draftDate : item.date || date,
            at: this.data.timeManual ? this.data.draftAt : item.at || '',
            planned: this.data.planManual ? this.data.planned : item.planned, card: this.data.timeManual || this.data.dateManual && item.date && item.date !== this.data.draftDate ? clearInterval(item.card) : item.card || null };
        });
        this.analysisText = text; this.analyzedAt = Date.now();
        const first = events[0];
        this.setData({ knownTypes: r.knownTypes || [], newTypes: r.newTypes || [], newTypesLabel: (r.newTypes || []).join('、'), analysisEvents: events, draftDate: first.date, draftAt: first.at, planned: first.planned,
          clarificationQuestion: r.question || '', clarificationAnswer: '',
          recognitionStatus: events.length > 1 ? '识别到' + events.length + '件事，请检查后确认拆分' : '已识别，可直接修改日期和时间',
          recognitionWarning: [...new Set(warnings.filter(Boolean))].join('；') });
        this.persistDraft();
        return true;
      } catch (err) {
        if (current()) this.setData({ recognitionStatus: err.message || '识别失败，请手动检查', recognitionWarning: '' });
        return false;
      } finally {
        if (current()) { this.analysisTask = null; this.setData({ recognizing: false }); }
      }
    })();
    this.analysisTask = task;
    return task;
  },

  persistDraft() {
    if (!this.draftKey || this.pendingSave) return;
    try {
      if (!this.data.text && !this.data.images.length) {
        wx.removeStorageSync(this.draftKey);
        this.setData({ draftStatus: '', draftDate: '' });
      } else {
        wx.setStorageSync(this.draftKey, { text: this.data.text, images: this.data.images,
          kind: this.data.kind, kindManual: this.data.kindManual, sourceOutboxId: this.sourceOutboxId || '', date: this.data.draftDate || this.data.selectedDate,
          baseDate: this.data.draftBaseDate, at: this.data.draftAt, dateManual: this.data.dateManual, timeManual: this.data.timeManual,
          planned: this.data.planned, planManual: this.data.planManual,
          knownTypes: this.data.knownTypes, newTypes: this.data.newTypes, proposals: this.proposalEdited ? this.data.analysisEvents : null });
        this.setData({ draftStatus: '草稿已保存在本机' });
      }
    } catch (e) {
      this.setData({ draftStatus: '草稿保存失败，请勿退出页面' });
    }
  },

  clearDraft(keepFiles = false) {
    if (!this.draftKey) return;
    if (this.voice) this.voice.reset();
    const draft = wx.getStorageSync(this.draftKey);
    wx.removeStorageSync(this.draftKey);
    if (!keepFiles && draft && this.member) outbox.releaseFiles(this.member, draft.images || []);
    this.sourceOutboxId = '';
    this.resetRecognition();
    this.setData({ composerOpen: true, kindManual: false, draftDate: '', draftBaseDate: '', draftStatus: '', draftAt: '', dateManual: false, timeManual: false, planned: false, planManual: false });
  },

  discardDraft() {
    if (this.data.busy || this.data.savePending || this.data.pickingImages || this.data.recording || this.data.transcribing || this.data.voiceStarting) return;
    wx.showModal({ title: '清除本机草稿？', content: '未提交的文字和图片将被清除。', success: (r) => {
      if (!r.confirm || this.data.busy || this.data.savePending || this.data.pickingImages || this.data.recording || this.data.transcribing || this.data.voiceStarting) return;
      this.clearDraft();
      this.setData({ text: '', images: [], kind: 'daily' });
    } });
  },

  async onPickImage() {
    if (this.data.busy || this.data.savePending || this.data.pickingImages || this.data.recording || this.data.transcribing || (!this.data.canEdit && !this.data.localMode)) return;
    const left = 9 - this.data.images.length;
    if (left <= 0) {
      wx.showToast({ title: '一次最多 9 张', icon: 'none' });
      return;
    }
    this.setData({ pickingImages: true });
    try {
      const res = await wx.chooseMedia({
        count: left,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      });
      const picked = res.tempFiles || [];
      for (let i = 0; i < picked.length; i += 1) {
        let src = picked[i].tempFilePath;
        try {
          const out = await wx.compressImage({
            src,
            quality: 70,
            compressedWidth: 1600,
          });
          if (out && out.tempFilePath) src = out.tempFilePath;
        } catch (e) {
          // 压缩失败就用原图，不阻断
        }
        // 临时图片重启后可能失效，先保存到本机，再把路径写入草稿。
        const saved = await new Promise((resolve, reject) => wx.saveFile({ tempFilePath: src, success: resolve, fail: reject }));
        this.setData({ images: this.data.images.concat(saved.savedFilePath),
          draftDate: this.data.draftDate || this.data.today });
        this.persistDraft();
      }
    } catch (err) {
      if (!String(err.errMsg || '').includes('cancel')) wx.showToast({ title: /quota|exceed|space|storage|limit/i.test(err.errMsg || '') ? '本机空间不足，请先同步已有照片' : '图片未全部保存，请重试', icon: 'none' });
    } finally { this.setData({ pickingImages: false }); }
  },

  onRemoveImage(e) {
    if (this.data.busy || this.data.savePending) return;
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.slice();
    const path = images[index];
    images.splice(index, 1);
    this.setData({ images });
    this.persistDraft();
    if (path && this.member) outbox.releaseFiles(this.member, [path]);
  },

  onPreview(e) {
    const src = e.currentTarget.dataset.src;
    const all = e.currentTarget.dataset.all || [src];
    wx.previewImage({ current: src, urls: all });
  },

  draftSnapshot() {
    return { text: this.data.text, images: this.data.images.slice(), kind: this.data.kind,
      date: this.data.draftDate || this.data.today, baseDate: this.data.draftBaseDate || this.data.today,
      at: this.data.draftAt || '', dateManual: this.data.dateManual, timeManual: this.data.timeManual,
      planned: this.data.planned, planManual: this.data.planManual, kindManual: this.data.kindManual,
      knownTypes: this.data.knownTypes, newTypes: this.data.newTypes, proposals: this.data.analysisEvents };
  },
  refreshQueue() {
    if (!this.member) return;
    try { this.setData({ queueCount: outbox.read(this.member).length }); }
    catch (err) { this.setData({ queueError: err.message }); }
  },
  async syncOutbox(force = false) {
    if (!this.member || this.data.syncing || this.data.offline) return;
    const member = this.member;
    this.setData({ syncing: true });
    try {
      const r = await outbox.flush(app, member, { force });
      if (this.disposed || !this.member || this.member._id !== member._id || this.member.family_code !== member.family_code) return;
      this.setData({ queueError: r.error }); this.refreshQueue();
      if (r.sent.length) { this.setData({ lastSavedId: r.sent[0], lastSavedCount: r.sent.length }); this.reload(false, true); }
    } catch (err) { if (!this.disposed) this.setData({ queueError: err.message }); }
    finally {
      if (!this.disposed) {
        this.setData({ syncing: false });
        if (!this.data.queueError && outbox.read(member).some((item) => item.confirmed && item.status === 'queued' && !item.lastAttempt)) this.syncOutbox();
      }
    }
  },
  applyIncomingDraft() {
    const incoming = app.globalData.entryImport;
    if (!incoming || !this.member) return;
    if (incoming.memberId !== this.member._id || incoming.familyCode !== this.member.family_code) throw new Error('家庭身份已变化，未带入其他家庭的草稿');
    const value = outbox.form(incoming.form);
    if ((this.data.text || this.data.images.length) && this.sourceOutboxId !== incoming.id) outbox.add(this.member, this.draftSnapshot());
    this.resetRecognition(); this.sourceOutboxId = incoming.id || '';
    this.setData({ text: value.text, images: value.images, kind: value.kind, kindManual: value.kindManual === true,
      draftDate: value.date, draftBaseDate: value.baseDate || value.date, draftAt: value.at || '',
      dateManual: value.dateManual === true, timeManual: value.timeManual === true, planned: value.planned === true,
      planManual: value.planManual === true, analysisEvents: value.proposals || [], knownTypes: value.knownTypes || [], newTypes: value.newTypes || [],
      draftStatus: '已带入本机草稿；原有输入保留在草稿箱', composerOpen: true });
    if (value.proposals && value.proposals.length) { this.analysisText = value.text.trim(); this.analyzedAt = Date.now(); this.proposalEdited = true; }
    app.globalData.entryImport = null; this.persistDraft();
  },
  toggleInputMode() {
    if (this.data.recording || this.data.transcribing || this.data.voiceStarting || this.data.busy) return;
    this.setData({ inputMode: this.data.inputMode === 'voice' ? 'text' : 'voice' });
  },
  voiceTap() { if (this.data.recording) this.stopVoice(); else this.startVoice(); },
  inputActions() {
    if (this.data.busy || this.data.recording || this.data.transcribing || this.data.voiceStarting) return;
    wx.showActionSheet({ itemList: ['添加照片', '识别照片文字', '待同步与草稿', '重复记录核对'], success: ({ tapIndex }) => {
      if (tapIndex === 0) this.onPickImage();
      else wx.navigateTo({ url: ['/pages/import/import', '/pages/outbox/outbox', '/pages/quality/quality'][tapIndex - 1] });
    } });
  },
  goOutbox() { wx.navigateTo({ url: '/pages/outbox/outbox' }); },
  openLastSaved() { if (this.data.lastSavedId) wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(this.data.lastSavedId) }); },
  inspectDuplicate(e) { wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  duplicateKey() { return JSON.stringify([this.data.text.trim(), this.data.draftDate || this.data.today, this.data.draftAt, this.data.planned, this.data.images]); },
  keepSeparate() { this.duplicateAck = this.duplicateKey(); this.onSave(); },
  async onSave() {
    if (this.data.busy || this.data.pickingImages || this.data.recording || this.data.transcribing || this.data.voiceStarting || (!this.data.canEdit && !this.data.localMode)) return;
    const text = this.data.text.trim();
    if ((!text && !this.data.images.length) || text.length > 500) { wx.showToast({ title: '保留文字或照片，正文最多500字', icon: 'none' }); return; }
    this.setData({ busy: true });
    try {
      const recognized = text && !this.data.offline && !this.data.localMode ? await this.recognize() : this.analysisText === text && this.data.analysisEvents.length > 0;
      if (text !== this.data.text.trim()) return;
      if (this.data.assistantIntent) { wx.showToast({ title: '请打开智能助手检查结果', icon: 'none' }); return; }
      const events = recognized ? this.data.analysisEvents : [];
      const value = { content: text, happened_on: this.data.draftDate || this.data.today, at: this.data.draftAt, planned: this.data.planned, images: this.data.images };
      const pendingDuplicate = outbox.read(this.member).some((row) => row.confirmed && row.form.text.trim() === text
        && row.form.date === value.happened_on && (row.form.at || '') === (value.at || '') && !!row.form.planned === !!value.planned
        && (text || JSON.stringify(row.form.images) === JSON.stringify(value.images)));
      if (pendingDuplicate && this.duplicateAck !== this.duplicateKey()) { this.setData({ pendingDuplicate: true }); return; }
      const duplicates = review.candidates(this.all, value);
      if (duplicates.length && this.duplicateAck !== this.duplicateKey()) { this.setData({ duplicateCandidates: duplicates }); return; }
      const newTypes = this.data.newTypes.filter((name) => events.some((item) => item.card && item.card.type === name));
      if (newTypes.length || text && !recognized || events.length > 1 || this.data.planned || this.data.clarificationQuestion) {
        const confirmed = await new Promise((resolve) => wx.showModal({ title: '核对后保存',
          content: [!recognized && text ? '暂时未能智能整理，将保留当前原文。' : '', this.data.recognitionWarning, this.data.clarificationQuestion ? '尚待确认：' + this.data.clarificationQuestion + ' 未补充时将按当前预览保存，请确认。' : '',
            '日期：' + value.happened_on + '，时间：' + (value.at || '本次记录时间'),
            events.length > 1 ? '将拆为' + events.length + '条记录。' : '', newTypes.length ? '新类型：' + newTypes.join('、') : '',
            this.data.planned ? '作为待办计划保存。' : '', '内容先保存在本机，联网并核对身份后同步；原文可在待同步箱查看。'].filter(Boolean).join('\n'),
          confirmText: '确认保存', cancelText: '返回检查', success: (r) => resolve(r.confirm), fail: () => resolve(false) }));
        if (!confirmed) return;
      }
      const kindFor = (card) => this.data.kindManual ? this.data.kind : card && card.type === '健康' ? 'health' : card && card.type === '里程碑' ? 'first' : this.data.kind;
      const payload = { requestId: outbox.id(), content: text, kind: kindFor(events[0] && events[0].card), happened_on: value.happened_on,
        kindConfirmed: this.data.kindManual === true,
        smartInput: 1, cards: 1, approvedTypes: newTypes, card: events.length === 1 ? events[0].card || null : null,
        at: this.data.draftAt || '', planned: this.data.planned,
        items: events.length > 1 ? events.map((item) => ({ content: item.content, kind: kindFor(item.card), happened_on: item.date,
          at: item.at || '', planned: item.planned, card: item.card || null })) : undefined };
      const snapshot = this.draftSnapshot(); snapshot.text = text; snapshot.date = value.happened_on;
      outbox.add(this.member, snapshot, payload, this.sourceOutboxId);
      this.sourceOutboxId = '';
      try { this.clearDraft(true); }
      catch (err) { this.resetRecognition(); this.setData({ queueError: '内容已进入待同步箱，但输入草稿清理失败；重新打开时请先核对待同步箱' }); }
      this.setData({ text: '', images: [], kind: 'daily', duplicateCandidates: [] }); this.refreshQueue();
      wx.showToast({ title: '已存本机，等待同步', icon: 'none' });
      this.syncOutbox(true);
    } catch (err) { wx.showToast({ title: err.message || '未能存入本机，请保留输入', icon: 'none' }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },

  async autoTag(id, content, pickedKind) {
    if (!id) return;
    this.tagging = this.tagging || new Set();
    if (this.tagging.has(id)) return;
    this.tagging.add(id);
    const family = this.member && this.member.family_code;
    const update = (label) => {
      if (this.disposed || !this.member || this.member.family_code !== family) return;
      this.aiStates = Object.assign({}, this.aiStates, { [id]: label }); this.render();
    };
    update('已保存 · 正在整理标签…');
    try {
      const r = await app.entryRequest({ action: 'tag', id, content, pickedKind });
      update(r.changed ? '' : '已保存 · 未覆盖现有信息');
      if (!this.disposed && this.member && this.member.family_code === family) await this.reload();
    } catch (e) { update('已保存 · 标签整理失败，点此重试'); }
    finally { this.tagging.delete(id); }
  },

  onRetryTag(e) {
    if (!this.data.canEdit || this.data.busy) return;
    const entry = this.all.find((item) => item._id === e.currentTarget.dataset.id);
    if (entry && entry.content && !entry.manually_edited) this.autoTag(entry._id, entry.content, entry.kind);
  },

  onDelete(e) {
    if (this.deleting || this.data.busy || !this.data.canEdit) return;
    const id = e.currentTarget.dataset.id;
    this.deleting = true;
    wx.showModal({
      title: '删掉这条？',
      content: '这条记录将从日历和时间轴中移除。',
      confirmText: '删掉',
      confirmColor: '#0e9187',
      success: async (r) => {
        if (!r.confirm) { this.deleting = false; return; }
        this.setData({ busy: true });
        try {
          const capabilities = await app.getEntryCapabilities();
          const entry = this.all.find((item) => item._id === id);
          if (!entry) throw new Error('记录状态已变化，请刷新');
          if (!capabilities.softDeleteOnly && entry.images && entry.images.length) {
            throw new Error('请更新云函数后再安全删除图片记录');
          }
          const res = await wx.cloud.callFunction({
            name: 'entries',
            data: { action: 'remove', id, revision: entry.revision || 0 },
          });
          const result = res && res.result;
          if (!result || !result.ok) throw new Error((result && result.error) || '没删掉');
          this.undoDelete = { id, revision: result.revision, familyCode: this.member.family_code, memberId: this.member._id };
          this.setData({ undoAvailable: true }); this.reload(false, true);
        } catch (err) {
          wx.showToast({ title: (err.message || '没删掉').slice(0, 20), icon: 'none' });
          this.init();
        } finally {
          this.deleting = false;
          this.setData({ busy: false });
        }
      },
      fail: () => { this.deleting = false; },
    });
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.tag;
    if (!tag) return;
    wx.navigateTo({ url: '/pages/search/search?q=' + encodeURIComponent(tag) });
  },

  async undoRemoval() {
    if (this.data.busy || !this.undoDelete) return;
    const value = this.undoDelete;
    this.setData({ busy: true });
    try {
      const member = await app.ensureMember();
      if (!member || member._id !== value.memberId || member.family_code !== value.familyCode) throw new Error('家庭身份已变化，请在原家庭回收站恢复');
      await app.entryRequest({ action: 'restore', id: value.id, revision: value.revision });
      this.undoDelete = null; this.setData({ undoAvailable: false }); this.reload(false, true);
    } catch (err) { wx.showToast({ title: err.message || '恢复失败，请到回收站核对', icon: 'none' }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goMembers() {
    wx.switchTab({ url: '/pages/members/members' });
  },

  goLibrary() {
    wx.navigateTo({ url: '/pages/library/library' });
  },

  goGrowth() { wx.switchTab({ url: '/pages/growth/growth' }); },
  goAssistant() { if (!this.data.busy && !this.data.savePending) app.openAssistant(this.data.assistantIntent ? this.data.text.trim() : ''); },

  onEntryMenu(e) {
    if (this.data.busy || !this.data.canEdit) return;
    const id = e.currentTarget.dataset.id;
    const entry = this.all.find((item) => item._id === id);
    if (!entry) return;
    wx.showActionSheet({ itemList: ['编辑记录', entry.favorite ? '取消里程碑收藏' : '收藏为里程碑', '删除记录'],
      success: async ({ tapIndex }) => {
        if (tapIndex === 0) wx.navigateTo({ url: '/pages/edit/edit?id=' + encodeURIComponent(id) });
        else if (tapIndex === 2) this.onDelete(e);
        else if (tapIndex === 1) {
          if (this.data.busy) return;
          this.setData({ busy: true });
          try {
            await app.requireRecordTools();
            await app.entryRequest({ action: 'favorite', id, favorite: !entry.favorite, revision: entry.revision || 0 });
            await this.reload();
          } catch (err) { wx.showToast({ title: err.message, icon: 'none' }); }
          finally { this.setData({ busy: false }); }
        }
      },
    });
  },
});
