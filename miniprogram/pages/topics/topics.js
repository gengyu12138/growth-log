const app = getApp();
const views = require('../../utils/assistant');
const outbox = require('../../utils/outbox');
const dates = require('../../utils/date');
Page({
  data: { topics: [], entries: [], selectedId: '', selected: null, loading: false, busy: false, error: '', status: '', migration: false,
    editing: false, editId: '', title: '', words: '', types: [], typesLabel: '', picking: false, choices: [], selectedCount: 0, missingCount: 0 },
  onLoad() { this.load(); },
  onUnload() { this.closed = true; this.version = (this.version || 0) + 1; this.persist(); },
  async load() {
    if (this.data.busy) return;
    const version = this.version = (this.version || 0) + 1;
    this.setData({ loading: !this.rows, error: '' });
    try {
      const member = await app.ensureMember();
      if (!member) throw new Error('请先加入家庭');
      this.member = member; this.draftKey = 'topicDraft:' + member._id + ':' + member.family_code;
      const caps = await app.getEntryCapabilities(); this.cloudSupported = caps.cloudViews === 1 && caps.topics === 1;
      this.allViews = views.readViews(wx, member);
      let migration = false;
      if (this.cloudSupported) {
        const r = await app.entryRequest({ action: 'getViews' });
        if (version !== this.version) return;
        this.revision = r.revision; const merged = views.acceptCloudViews(wx, member, r);
        this.allViews = merged.views; migration = merged.migration;
      }
      this.rows = await app.collectEntries({}, member.family_code, () => version !== this.version);
      if (version !== this.version) return;
      this.setData({ topics: this.allViews.filter((view) => view.intent === 'topic'), migration,
        status: migration ? '已保留本机专题，点击同步后可在其他设备读取' : this.cloudSupported ? '专题保存在你的关注项中，可跨设备读取' : '专题仅保存在本机；云端同步待管理员更新服务' });
      this.show(this.data.selectedId);
      const incoming = app.globalData.topicImport;
      if (incoming) {
        if (incoming.memberId !== member._id || incoming.familyCode !== member.family_code) throw new Error('专题草稿的家庭身份已变化');
        this.begin({ title: incoming.title, keywords: incoming.keywords || [], types: incoming.types || [], entryIds: [] });
        app.globalData.topicImport = null;
      } else if (!this.data.editing) {
        const draft = wx.getStorageSync(this.draftKey);
        if (draft && typeof draft.title === 'string' && Array.isArray(draft.entryIds)) this.begin(draft);
      }
    } catch (err) { if (version === this.version) this.setData({ error: err.message || '专题读取失败' }); }
    finally { if (version === this.version) this.setData({ loading: false }); }
  },
  show(id) {
    const selected = this.data.topics.find((view) => view.id === id) || this.data.topics[0];
    if (!selected) { this.setData({ selected: null, selectedId: '', entries: [] }); return; }
    const base = (this.rows || []).filter((row) => !row.planned && ((selected.entryIds || []).includes(row._id)
      || selected.types.includes(row.card && row.card.type) || selected.keywords.some((word) => (row.content || '').includes(word))));
    const matched = new Set(base.map((row) => row._id)), related = new Set(), byId = new Map((this.rows || []).map((row) => [row._id, row]));
    const validLink = (link) => byId.has(link.id) && (byId.get(link.id).revision || 0) === link.revision;
    base.forEach((row) => (row.card && row.card.related || []).filter(validLink).forEach((link) => related.add(link.id)));
    const entries = (this.rows || []).filter((row) => !row.planned && (matched.has(row._id) || related.has(row._id)
      || (row.card && row.card.related || []).some((link) => matched.has(link.id) && validLink(link)))).map((row) => Object.assign({}, row,
      { timeLabel: dates.entryTime(row), yearLabel: row.happened_on.slice(0, 4), dayLabel: row.happened_on.slice(5).replace('-', '.'), linked: !matched.has(row._id) })).sort((a, b) => (a.happened_on + (a.at || '')).localeCompare(b.happened_on + (b.at || '')));
    this.setData({ selected, selectedId: selected.id, entries, ruleLabel: [...selected.keywords, ...selected.types].join(' / ') || '手动选取原记录' });
  },
  select(e) { if (!this.data.editing && !this.data.busy) this.show(e.currentTarget.dataset.id); },
  create() { if (!this.data.editing) this.begin({ title: '', keywords: [], types: [], entryIds: [] }); },
  edit() { if (this.data.selected) this.begin(this.data.selected); },
  begin(value) {
    this.entryIds = value.entryIds.slice();
    const valid = new Set((this.rows || []).map((row) => row._id));
    this.setData({ editing: true, editId: value.id || '', title: value.title, words: value.keywords.join('，'), types: value.types,
      typesLabel: value.types.join(' / '), selectedCount: value.entryIds.filter((id) => valid.has(id)).length,
      missingCount: value.entryIds.filter((id) => !valid.has(id)).length, picking: false, error: '' });
  },
  onInput(e) { if (!this.data.busy) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); this.persist(); } },
  persist() {
    if (!this.data.editing || !this.draftKey) return;
    try { wx.setStorageSync(this.draftKey, { id: this.data.editId, title: this.data.title,
      keywords: this.data.words.split(/[，,、\n]/).map((word) => word.trim()).filter(Boolean), types: this.data.types, entryIds: this.entryIds || [] }); }
    catch (err) { if (!this.closed) this.setData({ error: '本机草稿未能保存，请保留输入后重试' }); }
  },
  togglePicker() {
    this.setData({ picking: !this.data.picking, choices: (this.rows || []).filter((row) => !row.planned).map((row) => ({ _id: row._id,
      happened_on: row.happened_on, content: row.content, checked: (this.entryIds || []).includes(row._id) })) });
  },
  onRecords(e) { this.entryIds = e.detail.value; this.setData({ selectedCount: this.entryIds.length, missingCount: 0 }); this.persist(); },
  cancel() { if (!this.data.busy) { this.setData({ editing: false }); wx.removeStorageSync(this.draftKey); } },
  async store(next) {
    if (next.length > 20) throw new Error('专题和关注项合计最多20个，请先移除不需要的项目');
    const current = await app.ensureMember();
    if (!current || current._id !== this.member._id || current.family_code !== this.member.family_code) throw new Error('家庭身份已变化，请重新读取');
    if (this.cloudSupported) {
      const r = await app.entryRequest({ action: 'saveViews', memberId: current._id, familyCode: current.family_code, revision: this.revision, views: next });
      if (!Array.isArray(r.views) || !Number.isSafeInteger(r.revision)) throw new Error('专题保存结果异常，请重新读取');
      next = r.views; this.revision = r.revision;
      wx.setStorageSync(views.storageKey(current) + ':revision', r.revision);
      wx.removeStorageSync(views.storageKey(current) + ':dirty');
    } else wx.setStorageSync(views.storageKey(current) + ':dirty', true);
    wx.setStorageSync(views.storageKey(current), next); this.allViews = next;
    this.setData({ topics: next.filter((view) => view.intent === 'topic'), migration: false, status: this.cloudSupported ? '专题已同步' : '专题已保存到本机，云同步待服务更新' });
  },
  async sync() {
    if (this.data.busy || this.data.loading || !this.cloudSupported) return;
    this.setData({ busy: true, error: '' });
    try { await this.store(this.allViews); }
    catch (err) { if (!this.closed) this.setData({ error: err.message }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  async save() {
    if (this.data.busy || this.data.loading) return;
    this.setData({ busy: true, error: '' });
    try {
      const title = this.data.title.trim(), keywords = [...new Set(this.data.words.split(/[，,、\n]/).map((word) => word.trim()).filter(Boolean))];
      const valid = new Set(this.rows.filter((row) => !row.planned).map((row) => row._id));
      const entryIds = (this.entryIds || []).filter((id) => valid.has(id));
      if (!title || title.length > 30 || keywords.length > 6 || keywords.some((word) => word.length > 30) || entryIds.length > 200) throw new Error('名称最多30字，关键词最多6个，每个30字，手选最多200条');
      if (!keywords.length && !this.data.types.length && !entryIds.length) throw new Error('请填关键词或手动选取原记录');
      const topic = { intent: 'topic', id: this.data.editId || outbox.id(), title, window: { kind: 'all' }, keywords,
        types: this.data.types, entryIds, fields: [], warning: '', question: '', candidates: [] };
      const next = this.allViews.filter((view) => view.intent !== 'topic' || view.id !== topic.id).concat(topic);
      await this.store(next); wx.removeStorageSync(this.draftKey);
      this.setData({ editing: false }); this.show(topic.id);
    } catch (err) { if (!this.closed) this.setData({ error: err.message }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  async remove() {
    if (this.data.busy || !this.data.selected) return;
    const r = await wx.showModal({ title: '移除这个专题？', content: '只移除专题配置，原记录继续保留。' });
    if (!r.confirm) return;
    this.setData({ busy: true, error: '' });
    try { await this.store(this.allViews.filter((view) => view.intent !== 'topic' || view.id !== this.data.selectedId)); this.show(''); }
    catch (err) { if (!this.closed) this.setData({ error: err.message }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  open(e) { wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
});
