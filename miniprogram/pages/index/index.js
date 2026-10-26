const dateUtil = require('../../utils/date');
const { editField, clearInterval } = require('../../utils/cards');
const { readViews } = require('../../utils/assistant');

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
    loading: true,
    hasMore: false,
    loadError: '',
    monthAnim: '',
    today: '',
    viewMode: 'calendar',
    timeline: [],
    statusBar: 20,
    barHeight: 44,
    navTotal: 64,
    babyLabel: '',
    profileError: '',
  },

  onLoad(options) {
    this.disposed = false;
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
    this.analysisVersion = (this.analysisVersion || 0) + 1;
    this.persistDraft();
    this.initId = (this.initId || 0) + 1;
    this.reloadId = (this.reloadId || 0) + 1;
    clearTimeout(this.flipTimer);
    if (this.kbHandler) wx.offKeyboardHeightChange(this.kbHandler);
  },

  onHide() {
    this.persistDraft();
  },

  onShow() {
    const today = dateUtil.fmtDate(new Date());
    if (today !== this.data.today) this.setData({ today });
    this.init();
  },

  async init() {
    const id = this.initId = (this.initId || 0) + 1;
    this.setData({ canEdit: false });
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
      this.pendingSave = pending && pending.familyCode === member.family_code ? pending : null;
      const patch = { canEdit: member.role === 'owner' || member.role === 'editor' };
      if (firstLoad) { this.resetRecognition(); this.aiStates = {}; }
      if (firstLoad) Object.assign(patch, { viewMode: member.role === 'viewer' ? 'timeline' : 'calendar',
        text: '', images: [], kind: 'daily', draftDate: '', draftBaseDate: '', draftStatus: '', draftAt: '', dateManual: false, timeManual: false, planned: false, planManual: false, savePending: false, saveRetrySafe: false });
      if (this.pendingSave) {
        Object.assign(patch, {
          text: pending.content, images: pending.images, kind: pending.kind,
          selectedDate: pending.happened_on, savePending: true, saveRetrySafe: pending.retrySafe === true,
          draftDate: pending.happened_on, draftBaseDate: pending.happened_on, draftAt: pending.at || '', planned: pending.planned === true,
          analysisEvents: pending.items || [],
        });
        this.month = dateUtil.startOfMonth(dateUtil.parseDate(pending.happened_on));
      } else if (firstLoad) {
        const draft = wx.getStorageSync(this.draftKey);
        if (draft && typeof draft.text === 'string' && Array.isArray(draft.images)) {
          const images = draft.images.filter((path) => {
            try { wx.getFileSystemManager().accessSync(path); return true; } catch (e) { return false; }
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
          Object.assign(patch, { text: draft.text, images, kind: draft.kind,
            draftDate: draft.date, draftBaseDate: draft.baseDate || draft.date, draftAt: draft.at || '', dateManual: draft.dateManual === true,
            timeManual: draft.timeManual === true, planned: draft.planned === true, planManual: draft.planManual === true, draftStatus: images.length === draft.images.length
              ? '已恢复本机草稿' : '已恢复文字，部分图片已失效，请重新选择' });
        }
      }
      this.setData(patch);
      await Promise.all([this.reload(), this.loadProfile(id)]);
    } catch (e) {
      if (id === this.initId) {
        this.identityFailed = true;
        this.setData({ loading: false, loadError: '身份核对失败，请重试' });
      }
    }
  },

  async loadProfile(id = this.initId) {
    this.profile = null;
    this.setData({ babyLabel: '', profileError: '' });
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

  async reload(append = false) {
    if (append && (this.data.loading || !this.cursor)) return;
    const id = this.reloadId = (this.reloadId || 0) + 1;
    const identityCheck = this.initId;
    const isCalendar = this.data.viewMode === 'calendar';
    const month = dateUtil.fmtDate(this.month).slice(0, 7);
    let cursor = append ? this.cursor : null;
    if (!append) {
      this.all = [];
      this.cursor = null;
    }
    this.setData({ loading: true, loadError: '', hasMore: Boolean(cursor) });
    this.render();
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

        const existing = new Set(this.all.map((e) => e._id));
        this.all = this.all.concat(r.list.filter((e) => !existing.has(e._id)).map((e) => {
          const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(e.at || '') ? e.at : '';
          return Object.assign({}, e, {
            images: e.images || [],
            tags: e.tags || [],
            place: e.place || '',
            note: e.note || '',
            at,
            timeLabel: at || dateUtil.fmtTime(e.created_at),
            recordedLabel: at ? '' : dateUtil.recordedTimeLabel(e.created_at),
            fromText: Boolean(at),
            temp: typeof e.temp === 'number' ? e.temp : null,
            meds: e.meds || [],
            kindLabel: KIND_LABEL[e.kind] || '日常',
            seal: KIND_SEAL[e.kind] || '日',
          });
        }));
        cursor = r.nextCursor;
        this.cursor = cursor;
        this.setData({ hasMore: Boolean(cursor) });
        this.render();
        // 日历需读完整个月才能准确标记日期；时间轴由用户按需读取更早记录。
      } while (isCalendar && cursor);
    } catch (err) {
      if (id !== this.reloadId || identityCheck !== this.initId) return;
      this.setData({ loadError: '记录未读取完成，请重试' });
    }
    this.setData({ loading: false });
    this.render();
  },

  onLoadMore() {
    return this.reload(true);
  },

  onRetry() {
    if (this.identityFailed) return this.init();
    return this.reload(Boolean(this.cursor));
  },

  render() {
    const monthKey = `${this.month.getFullYear()}-${dateUtil.pad(this.month.getMonth() + 1)}`;
    const counts = {};
    let monthCount = 0;

    for (const e of this.all) {
      if (e.happened_on && e.happened_on.slice(0, 7) === monthKey) {
        counts[e.happened_on] = (counts[e.happened_on] || 0) + 1;
        monthCount += 1;
      }
    }

    const cells = dateUtil.buildCalendar(this.month).map((c) => (
      c ? { day: c.day, date: c.date, count: counts[c.date] || 0 } : null
    ));

    const entries = this.all.map((e) => Object.assign({}, e, {
      aiLabel: e.manually_edited ? '' : this.aiStates && Object.prototype.hasOwnProperty.call(this.aiStates, e._id) ? this.aiStates[e._id] : (e.ai_status === 'pending' ? '已保存 · 标签待整理，点此重试' : ''),
      ageLabel: this.profile ? dateUtil.ageLabel(this.profile.birthday, e.happened_on) : '',
    }));
    const byEventTime = (a, b) => b.timeLabel.localeCompare(a.timeLabel)
      || b.created_at - a.created_at || String(b._id).localeCompare(String(a._id));
    const dayEntries = this.data.viewMode === 'calendar' ? entries
      .filter((e) => e.happened_on === this.data.selectedDate)
      .sort(byEventTime) : [];

    const total = this.all.length;

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
    this.reload();
  },

  onPickDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    const patch = { selectedDate: date };
    if (!this.data.text && !this.data.images.length && !this.data.busy && !this.data.savePending) {
      Object.assign(patch, { draftDate: date, draftBaseDate: date, dateManual: true });
    }
    this.setData(patch, () => this.render());
  },

  onKind(e) {
    if (this.data.busy || this.data.savePending || !this.data.canEdit) return;
    this.setData({ kind: e.currentTarget.dataset.kind });
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
    const baseDate = this.data.text ? this.data.draftBaseDate || this.data.selectedDate : this.data.selectedDate;
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
    this.setData({ recognizing: false, recognitionStatus: '', recognitionWarning: '', analysisEvents: [], newTypes: [], newTypesLabel: '', assistantIntent: '' });
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
        const r = await app.entryRequest({ action: 'analyze', content: text, selectedDate: date, cards: caps.dynamicCards === 1 ? 1 : undefined,
          assistant: caps.assistant === 1 ? 1 : undefined, trackers: caps.assistant === 1 ? readViews(wx, this.member).filter((v) => v.intent === 'tracker') : undefined });
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
          kind: this.data.kind, date: this.data.draftDate || this.data.selectedDate,
          baseDate: this.data.draftBaseDate, at: this.data.draftAt, dateManual: this.data.dateManual, timeManual: this.data.timeManual,
          planned: this.data.planned, planManual: this.data.planManual,
          knownTypes: this.data.knownTypes, newTypes: this.data.newTypes, proposals: this.proposalEdited ? this.data.analysisEvents : null });
        this.setData({ draftStatus: '草稿已保存在本机' });
      }
    } catch (e) {
      this.setData({ draftStatus: '草稿保存失败，请勿退出页面' });
    }
  },

  clearDraft() {
    if (!this.draftKey) return;
    const draft = wx.getStorageSync(this.draftKey);
    wx.removeStorageSync(this.draftKey);
    for (const path of (draft && draft.images) || []) {
      wx.removeSavedFile({ filePath: path, fail: () => {} });
    }
    this.resetRecognition();
    this.setData({ draftDate: '', draftBaseDate: '', draftStatus: '', draftAt: '', dateManual: false, timeManual: false, planned: false, planManual: false });
  },

  discardDraft() {
    if (this.data.busy || this.data.savePending || this.data.pickingImages) return;
    wx.showModal({ title: '清除本机草稿？', content: '未提交的文字和图片将被清除。', success: (r) => {
      if (!r.confirm || this.data.busy || this.data.savePending || this.data.pickingImages) return;
      this.clearDraft();
      this.setData({ text: '', images: [], kind: 'daily' });
    } });
  },

  async onPickImage() {
    if (this.data.busy || this.data.savePending || this.data.pickingImages || !this.data.canEdit) return;
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
          draftDate: this.data.draftDate || this.data.selectedDate });
        this.persistDraft();
      }
    } catch (err) {
      if (!String(err.errMsg || '').includes('cancel')) wx.showToast({ title: '图片未全部保存，请重试', icon: 'none' });
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
    if (path) wx.removeSavedFile({ filePath: path, fail: () => {} });
  },

  onPreview(e) {
    const src = e.currentTarget.dataset.src;
    const all = e.currentTarget.dataset.all || [src];
    wx.previewImage({ current: src, urls: all });
  },

  async onSave() {
    if (this.data.busy || this.data.pickingImages) return;
    if (!this.data.canEdit && !this.pendingSave) return;
    const text = this.data.text.trim();
    const local = this.data.images.slice();
    if (this.data.text.length > 500) { wx.showToast({ title: '正文超过500字，原文已保留', icon: 'none' }); return; }

    if (!text && !local.length) {
      wx.showToast({ title: '写点什么，或加张图', icon: 'none' });
      return;
    }

    this.setData({ busy: true });
    wx.showLoading({ title: '保存中', mask: true });

    const fileIDs = [];
    let submitted = Boolean(this.pendingSave);
    const hadPending = Boolean(this.pendingSave);

    try {
      const capabilities = await app.getEntryCapabilities();
      let pending = this.pendingSave;
      if (pending && (!pending.retrySafe || !capabilities.idempotentAdd)) {
        wx.hideLoading();
        // 旧服务不记录 requestId，响应丢失后无法自动判定是否已写入。
        const choice = await new Promise((resolve) => wx.showActionSheet({
          itemList: ['查看时间轴核对', '已保存，清除待确认', '确认未保存，重新提交'],
          success: (r) => resolve(r.tapIndex),
          fail: () => resolve(-1),
        }));
        if (choice === 0) {
          this.setData({ viewMode: 'timeline' });
          await this.reload();
        } else if (choice === 1) {
          wx.removeStorageSync(this.pendingKey);
          this.pendingSave = null;
          this.clearDraft();
          this.setData({ text: '', images: [], savePending: false, saveRetrySafe: false });
          await this.reload();
        }
        if (choice !== 2) return;
        pending.retrySafe = capabilities.idempotentAdd;
        wx.setStorageSync(this.pendingKey, pending);
        this.setData({ saveRetrySafe: pending.retrySafe });
        wx.showLoading({ title: '保存中', mask: true });
      }
      if (!pending) {
        wx.hideLoading();
        const recognized = text ? await this.recognize() : true;
        if (text !== this.data.text.trim() || !this.data.canEdit) return;
        if (this.data.assistantIntent) { wx.showToast({ title: '请打开智能助手检查结果', icon: 'none' }); return; }
        const events = recognized ? this.data.analysisEvents : [];
        const newTypes = this.data.newTypes.filter((name) => events.some((item) => item.card && item.card.type === name));
        const needsReview = newTypes.length || text && !recognized || this.data.recognitionWarning || events.length > 1 || this.data.planned;
        if (needsReview) {
          const content = !recognized ? '智能识别暂不可用。请核对输入区的日期、时间和计划开关；仍按当前设置保存？'
            : [newTypes.length ? '将新增记录类型：' + newTypes.join('、') + '，以后同类内容自动复用。' : '', this.data.recognitionWarning, events.length > 1 ? '将保存为' + events.length + '条独立记录，所选图片会附在每条记录上。'
              : this.data.planned ? '这条将保存为计划，不计入已发生的成长回顾。' : '将按输入区显示的日期和时间保存。'].filter(Boolean).join('\n');
          const confirmed = await new Promise((resolve) => wx.showModal({ title: '确认记录信息', content,
            confirmText: '确认保存', cancelText: '返回检查', success: (r) => resolve(r.confirm), fail: () => resolve(false) }));
          if (!confirmed) return;
        }
        if (events.some((item) => item.card) && capabilities.dynamicCards !== 1) throw new Error('请先更新云函数再保存智能卡片');
        if (capabilities.smartInput !== 1 && (this.data.timeManual || this.data.planned || events.length > 1)) {
          throw new Error('请先更新云函数再保存时间或计划');
        }
        wx.showLoading({ title: '保存中', mask: true });
        const kind = this.data.kind;
        const happenedOn = this.data.draftDate || this.data.selectedDate;
        const base = `entries/${this.member.family_code}/${Date.now()}`;
        for (let i = 0; i < local.length; i += 1) {
          const up = await wx.cloud.uploadFile({
            cloudPath: `${base}-${i}-${Math.random().toString(36).slice(2, 7)}.jpg`,
            filePath: local[i],
          });
          fileIDs.push(up.fileID);
        }
        pending = {
          familyCode: this.member.family_code,
          requestId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
            + Math.random().toString(36).slice(2),
          content: text, kind, happened_on: happenedOn, images: fileIDs,
          retrySafe: capabilities.idempotentAdd,
          smartInput: capabilities.smartInput === 1 ? 1 : undefined,
          cards: capabilities.dynamicCards === 1 ? 1 : undefined, approvedTypes: newTypes,
          card: events.length === 1 ? events[0].card : null,
          at: this.data.draftAt, planned: this.data.planned,
          items: events.length > 1 ? events.map((item) => ({ content: item.content, kind,
            happened_on: item.date, at: item.at, planned: item.planned, card: item.card || null })) : undefined,
        };
        // 先落本地再提交，断网或重启后仍使用同一标识、同一份内容确认结果。
        wx.setStorageSync(this.pendingKey, pending);
        this.pendingSave = pending;
        this.setData({ savePending: true, saveRetrySafe: pending.retrySafe });
      }
      if ((pending.items || pending.smartInput === 1) && capabilities.smartInput !== 1) throw new Error('请恢复新版云函数后再确认保存');
      if (pending.cards === 1 && capabilities.dynamicCards !== 1) throw new Error('请恢复新版云函数后再确认卡片保存');
      submitted = true;
      const res = await wx.cloud.callFunction({
        name: 'entries',
        data: {
          action: pending.items ? 'addBatch' : 'add',
          cards: pending.cards, card: pending.card, approvedTypes: pending.approvedTypes,
          smartInput: pending.smartInput, at: pending.at, planned: pending.planned, items: pending.items,
          requestId: pending.requestId,
          content: pending.content,
          kind: pending.kind,
          happened_on: pending.happened_on,
          images: pending.images,
        },
      });

      const r = (res && res.result) || {};
      if (r.ok === false && !hadPending) {
        // 首次提交被明确拒绝，保留原草稿并清理本次未使用的上传文件。
        wx.removeStorageSync(this.pendingKey);
        this.pendingSave = null;
        this.setData({ savePending: false, saveRetrySafe: false });
        submitted = false;
      }
      if (!r.ok) throw new Error(r.error || 'fail');

      wx.removeStorageSync(this.pendingKey);
      this.pendingSave = null;
      this.clearDraft();
      wx.hideLoading();
      this.setData({ text: '', images: [], savePending: false, saveRetrySafe: false });
      wx.showToast({ title: '记下了', icon: 'none' });
      this.reload();

      // 已保存与整理标签分开反馈；标签失败只重试识别，不重新新增。
      const savedItems = pending.items || [pending];
      savedItems.forEach((item, i) => { if (item.content) this.autoTag((r.ids || [r.id])[i], item.content, item.kind); });
    } catch (err) {
      if (!submitted && fileIDs.length) {
        wx.cloud.deleteFile({ fileList: fileIDs }).catch(() => {});
      }
      wx.hideLoading();
      const why = (err && err.message) || '';
      wx.showToast({ title: why && why !== 'fail' ? why.slice(0, 20)
        : (submitted ? '结果待确认，请核对保存' : '未提交，请重试'), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ busy: false });
    }
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
          this.reload();
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

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goMembers() {
    wx.navigateTo({ url: '/pages/members/members' });
  },

  goLibrary() {
    wx.navigateTo({ url: '/pages/library/library' });
  },

  goGrowth() { wx.navigateTo({ url: '/pages/growth/growth' }); },
  goAssistant() { if (!this.data.busy && !this.data.savePending) wx.navigateTo({ url: '/pages/assistant/assistant' + (this.data.assistantIntent ? '?prompt=' + encodeURIComponent(this.data.text.trim()) : '') }); },

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
