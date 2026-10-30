const dates = require('./date');
const FORM_KEYS = ['text', 'images', 'imageInsights', 'kind', 'date', 'baseDate', 'at', 'dateManual', 'timeManual', 'planned', 'planManual', 'kindManual', 'knownTypes', 'newTypes', 'proposals'];
let sending = null, sendingScope = '';
const key = (member) => 'entryQueue:' + member._id + ':' + member.family_code;
const same = (a, b) => a && b && a._id === b._id && a.family_code === b.family_code;
const id = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const copy = (value) => JSON.parse(JSON.stringify(value));

function form(value) {
  if (!value || typeof value.text !== 'string' || value.text.length > 500 || !Array.isArray(value.images)
    || value.images.length > 9 || value.images.some((path) => typeof path !== 'string')
    || !dates.validDate(value.date) || !['daily', 'first', 'health'].includes(value.kind)) throw new Error('本机草稿格式异常，请保留原内容并联系管理员');
  const result = {};
  if (value.imageInsights !== undefined && (!Array.isArray(value.imageInsights) || value.imageInsights.length > 9)) throw new Error('图片识别草稿格式异常，请保留原图后重试');
  for (const name of FORM_KEYS) if (value[name] !== undefined) result[name] = copy(value[name]);
  return result;
}
function read(member) {
  const value = wx.getStorageSync(key(member));
  if (!value) return [];
  if (!Array.isArray(value) || value.length > 50) throw new Error('待同步箱格式异常，请勿清空本机数据');
  const ids = new Set();
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9-]{16,80}$/.test(item.id) || ids.has(item.id)
      || item.memberId !== member._id || item.familyCode !== member.family_code
      || !['draft', 'queued', 'sending', 'uncertain', 'blocked'].includes(item.status)
      || !Number.isSafeInteger(item.attempts) || item.attempts < 0 || typeof item.confirmed !== 'boolean') throw new Error('待同步项身份或状态异常，请勿覆盖');
    form(item.form); ids.add(item.id);
    if (item.confirmed && (!item.payload || item.payload.requestId !== item.id || typeof item.payload.content !== 'string' || item.payload.content !== item.form.text.trim() || item.payload.happened_on !== item.form.date || !['daily', 'first', 'health'].includes(item.payload.kind))) throw new Error('待同步内容与提交标识不符');
  }
  return value;
}
function write(member, items) {
  if (items.length > 50 || JSON.stringify(items).length > 5 * 1024 * 1024) throw new Error('待同步箱已满，请先处理已有内容');
  wx.setStorageSync(key(member), items);
}
function patch(member, entryId, values) {
  const items = read(member), item = items.find((row) => row.id === entryId);
  if (!item) throw new Error('待同步项已变化，请刷新');
  Object.assign(item, values); write(member, items); return item;
}
function add(member, value, payload, sourceId) {
  const items = read(member), entryId = payload ? payload.requestId : id();
  if (items.some((row) => row.id === entryId)) return entryId;
  const snapshot = form(value);
  const replaced = items.find((row) => row.id === sourceId && !row.attempts && row.status !== 'sending');
  const remaining = items.filter((row) => row.id !== sourceId || row.attempts > 0 || row.status === 'sending');
  remaining.push({ id: entryId, memberId: member._id, familyCode: member.family_code, form: snapshot,
    payload: payload ? copy(payload) : null, confirmed: !!payload, status: payload ? 'queued' : 'draft',
    uploadedImages: [], attempts: 0, lastAttempt: 0, createdAt: Date.now(), error: '' });
  write(member, remaining);
  if (replaced) { try { releaseFiles(member, replaced.form.images); } catch (err) { /* 队列已保存；清理失败时保留本机文件。 */ } }
  return entryId;
}
function importPending(member, pending) {
  if (!pending || pending.familyCode !== member.family_code) return;
  if (read(member).some((row) => row.id === pending.requestId)) return;
  add(member, { text: pending.content, images: pending.images || [], kind: pending.kind,
    date: pending.happened_on, baseDate: pending.happened_on, at: pending.at || '', planned: pending.planned === true,
    proposals: pending.items ? pending.items.map((item) => ({ content: item.content, date: item.happened_on,
      at: item.at || '', planned: item.planned === true, card: item.card || null })) : [], newTypes: pending.approvedTypes || [] }, pending);
  patch(member, pending.requestId, { attempts: 1, status: 'uncertain', legacyUnsafe: pending.retrySafe !== true,
    everUncertain: true, error: '从上次保存恢复，请核对云端结果或沿用原提交重试' });
}
function releaseFiles(member, paths) {
  const used = read(member).flatMap((item) => item.form.images);
  const current = wx.getStorageSync('entryDraft:' + member._id + ':' + member.family_code);
  if (current && Array.isArray(current.images)) used.push(...current.images);
  for (const path of paths) if (!path.startsWith('cloud://') && !used.includes(path)) wx.removeSavedFile({ filePath: path, fail: () => {} });
}
function remove(member, entryId, completed = false) {
  const items = read(member), item = items.find((row) => row.id === entryId);
  if (!item) return;
  if (!completed && (item.attempts > 0 || item.status === 'sending')) throw new Error('保存结果可能已到云端，请先核对或使用原提交重试');
  write(member, items.filter((row) => row.id !== entryId));
  releaseFiles(member, item.form.images);
}
function request(item, images) {
  const result = { action: item.payload.items ? 'addBatch' : 'add', requestId: item.id,
    expectedFamilyCode: item.familyCode, expectedMemberId: item.memberId, images };
  for (const name of ['content', 'kind', 'kindConfirmed', 'happened_on', 'at', 'planned', 'smartInput', 'cards', 'card', 'approvedTypes', 'items']) {
    if (item.payload[name] !== undefined) result[name] = copy(item.payload[name]);
  }
  return result;
}
async function flush(app, member, options = {}) {
  if (sending) return sendingScope === key(member) ? sending : { sent: [], error: '其他家庭的同步尚未结束' };
  const candidates = read(member).filter((item) => item.confirmed && (!options.id || item.id === options.id));
  if (!candidates.length) return { sent: [], error: '' };
  sendingScope = key(member);
  sending = (async () => {
    const sent = [];
    try {
      const current = await app.ensureMember();
      if (!same(current, member) || !['owner', 'editor'].includes(current.role)) throw new Error('当前家庭身份不能同步，请核对后重试');
      const caps = await app.getEntryCapabilities();
      if (!caps.idempotentAdd || caps.scopedAdd !== 1) {
        for (const item of candidates) patch(member, item.id, { status: 'blocked', error: '服务尚未更新，内容已保存在本机；更新后可重新同步', needsUpdate: true });
        return { sent, error: '服务尚未更新' };
      }
      for (const old of candidates) {
        const item = read(member).find((row) => row.id === old.id);
        if (!item || !item.confirmed) continue;
        if (item.legacyUnsafe) { patch(member, item.id, { status: 'blocked', error: '旧服务无法按提交标识去重，请先人工核对已有记录' }); continue; }
        if (!options.force && (item.status === 'blocked' && !item.needsUpdate || item.attempts >= 3 || item.lastAttempt && Date.now() - item.lastAttempt < 30000)) continue;
        if (!same(app.globalData.member, member)) throw new Error('家庭身份已变化，同步已停止');
        patch(member, item.id, { status: 'sending', error: '', needsUpdate: false });
        let submitted = false;
        try {
          const images = (item.uploadedImages || []).slice();
          for (let i = 0; i < item.form.images.length; i += 1) {
            if (images[i]) continue;
            const path = item.form.images[i];
            if (path.startsWith('cloud://')) images[i] = path;
            else {
              if (!same(app.globalData.member, member)) throw new Error('家庭身份已变化，同步已停止');
              const r = await wx.cloud.uploadFile({ cloudPath: 'entries/' + member.family_code + '/' + item.id + '-' + i + '.jpg', filePath: path });
              images[i] = r.fileID;
            }
            patch(member, item.id, { uploadedImages: images.slice() });
          }
          if (!same(app.globalData.member, member)) throw new Error('家庭身份已变化，同步已停止');
          patch(member, item.id, { attempts: item.attempts + 1, lastAttempt: Date.now() });
          submitted = true;
          const r = await app.entryRequest(request(item, images));
          const ids = r.ids || (r.id ? [r.id] : []);
          if (ids.length !== (item.payload.items ? item.payload.items.length : 1) || ids.some((value) => typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))) throw new Error('保存结果缺少标识，请用原提交重试核对');
          sent.push(...ids);
          const legacyKey = 'pendingEntry:' + member._id, legacy = wx.getStorageSync(legacyKey);
          if (legacy && legacy.requestId === item.id && legacy.familyCode === member.family_code) wx.removeStorageSync(legacyKey);
          remove(member, item.id, true);
          const saved = item.payload.items || [item.payload];
          saved.forEach((row, index) => { if (row.content) app.entryRequest({ action: 'tag', id: ids[index], content: row.content, pickedKind: row.kind }).catch(() => {}); });
        } catch (err) {
          patch(member, item.id, { status: err.definite ? 'blocked' : submitted ? 'uncertain' : 'queued', lastAttempt: Date.now(),
            error: err.message || '同步未完成，内容仍在本机', needsUpdate: false,
            definiteRejection: err.definite === true, everUncertain: item.everUncertain === true || submitted && !err.definite });
        }
      }
      return { sent, error: '' };
    } catch (err) { return { sent, error: err.message || '暂时无法联网同步，内容仍在本机' }; }
  })().finally(() => { sending = null; sendingScope = ''; });
  return sending;
}
module.exports = { read, add, patch, remove, importPending, flush, form, id, releaseFiles };
