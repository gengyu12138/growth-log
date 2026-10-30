const assistant = require('./assistant');
function normalize(views, today) {
  if (!Array.isArray(views) || views.length > 20 || JSON.stringify(views).length > 40000) throw new Error('最多保存20个关注项');
  return views.map((view) => {
    if (!view || !['board', 'tracker', 'compare'].includes(view.intent)) throw new Error('关注项类型无效');
    const plan = assistant.normalizePlan(Object.assign({}, view, { warning: '', question: '', candidates: [] }), today);
    return { intent: plan.intent, title: plan.title, window: plan.window, types: plan.types, keywords: plan.keywords, fields: plan.fields,
      warning: '', question: '', candidates: [] };
  });
}
async function handle(db, member, event, today) {
  const existing = member.assistant_views === undefined ? [] : normalize(member.assistant_views, today);
  const revision = member.assistant_views_revision === undefined ? 0 : member.assistant_views_revision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('云端关注项版本异常');
  if (event.action === 'getViews') return { ok: true, views: existing, revision, member };
  if (event.memberId !== member._id || event.familyCode !== member.family_code) throw new Error('家庭身份已变化，请重新进入助手');
  if (!Number.isSafeInteger(event.revision) || event.revision < 0) throw new Error('请先读取云端关注项');
  const views = normalize(event.views, today);
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('members').doc(member._id);
    const { data: current } = await ref.get();
    if (!current || current.openid !== member.openid || current.family_code !== member.family_code) throw new Error('家庭身份已变化');
    const version = current.assistant_views_revision === undefined ? 0 : current.assistant_views_revision;
    const before = current.assistant_views === undefined ? [] : normalize(current.assistant_views, today);
    if (!Number.isSafeInteger(version) || version < 0) throw new Error('云端关注项版本异常');
    if (JSON.stringify(before) === JSON.stringify(views)) return { ok: true, views, revision: version };
    if (version !== event.revision) return { ok: false, code: 'CONFLICT', error: '其他设备已修改关注项，请重新读取后再保存' };
    await ref.update({ data: { assistant_views: views, assistant_views_revision: version + 1 } });
    return { ok: true, views, revision: version + 1 };
  });
}
module.exports = { handle };
