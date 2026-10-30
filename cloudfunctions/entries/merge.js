const crypto = require('crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
async function merge(context, member, event) {
  const { db, validDate, validTime, validateCard, revision, prepareCards, logEvent, orderedCard } = context;
  if (!['owner', 'editor'].includes(member.role)) return { ok: false, error: '只读成员不能合并记录' };
  if (event.confirmed !== true || event.familyCode !== member.family_code || event.memberId !== member._id) throw new Error('请核对家庭身份并确认合并预览');
  if (![event.id, event.otherId].every((id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)) || event.id === event.otherId
    || !/^[a-z0-9-]{16,80}$/.test(event.requestId || '')
    || ![event.revision, event.otherRevision].every((v) => Number.isSafeInteger(v) && v >= 0)) throw new Error('合并标识或版本无效');
  if (typeof event.content !== 'string' || event.content.length > 500 || typeof event.note !== 'string' || event.note.length > 200
    || !validDate(event.happened_on) || !['daily', 'first', 'health'].includes(event.kind) || event.at !== '' && !validTime(event.at)
    || typeof event.planned !== 'boolean' || typeof event.favorite !== 'boolean'
    || !Array.isArray(event.images) || event.images.length > 9 || new Set(event.images).size !== event.images.length) throw new Error('请检查合并后的正文、照片、日期与分类');
  const content = event.content.trim(), card = validateCard(event.card, content);
  if (!content && !event.images.length) throw new Error('合并后至少保留文字或照片');
  if (card && card.related.some((link) => [event.id, event.otherId].includes(link.id))) throw new Error('合并卡片不能再引用被合并的两条记录');
  const fields = { content, note: event.note.trim(), happened_on: event.happened_on, kind: event.kind,
    at: event.at, planned: event.planned, favorite: event.favorite, images: event.images, card };
  const digest = hash(JSON.stringify([event.id, event.otherId, event.revision, event.otherRevision, orderedCard(fields)]));
  return db.runTransaction(async (transaction) => {
    const auditRef = transaction.collection('entry_events').doc(event.id + '-' + (event.revision + 1));
    const { data: receipt } = await auditRef.get();
    if (receipt && receipt.family_code === member.family_code && receipt.actor_id === member._id
      && receipt.merge_request === event.requestId && receipt.merge_hash === digest) return { ok: true, id: event.id, revision: event.revision + 1, replayed: true };
    const { data: identity } = await transaction.collection('members').doc(member._id).get();
    if (!identity || identity.openid !== member.openid || identity.family_code !== member.family_code
      || !['owner', 'editor'].includes(identity.role)) throw new Error('家庭身份或权限已变化，请重新进入');
    const primaryRef = transaction.collection('entries').doc(event.id), secondaryRef = transaction.collection('entries').doc(event.otherId);
    const { data: primary } = await primaryRef.get(), { data: secondary } = await secondaryRef.get();
    if (![primary, secondary].every((row) => row && row.family_code === member.family_code && !row.deleted_at)) throw new Error('原记录已删除或不属于当前家庭');
    if (revision(primary) !== event.revision || revision(secondary) !== event.otherRevision) return { ok: false, code: 'CONFLICT', error: '原记录已经更新，请重新读取后核对合并' };
    const sourceImages = new Set([...(primary.images || []), ...(secondary.images || [])]);
    if (event.images.some((id) => !sourceImages.has(id))) throw new Error('只能选取原记录中已有的照片');
    const types = await prepareCards(transaction, member, [{ card }], event.approvedTypes);
    const now = Date.now(), next = Object.assign({}, fields, { revision: event.revision + 1, updated_at: now,
      manually_edited: true, ai_status: 'manual', time_confirmed: true, tags: [], place: '', temp: null, meds: [] });
    for (const type of types) await type.ref.set({ data: type.data });
    await primaryRef.update({ data: next });
    await secondaryRef.update({ data: { deleted_at: now, revision: event.otherRevision + 1, updated_at: now } });
    await logEvent(transaction, member, event.id, event.revision + 1, 'merge', Object.assign({}, primary, next));
    await auditRef.update({ data: { merge_request: event.requestId, merge_hash: digest, merged_from: event.otherId } });
    await logEvent(transaction, member, event.otherId, event.otherRevision + 1, 'remove', secondary);
    return { ok: true, id: event.id, revision: event.revision + 1 };
  });
}
module.exports = { merge };
