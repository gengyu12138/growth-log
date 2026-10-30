const assistant = require('./assistant');
function normalize(views, today) {
  if (!Array.isArray(views) || views.length > 20 || JSON.stringify(views).length > 40000) throw new Error('最多保存20个关注项');
  const topicIds = new Set();
  return views.map((view) => {
    if (view && view.intent === 'topic') {
      if (!/^[a-z0-9-]{16,80}$/.test(view.id || '') || typeof view.title !== 'string' || !view.title.trim() || view.title.length > 30
        || !['keywords', 'types'].every((key) => Array.isArray(view[key]) && view[key].length <= 6 && view[key].every((v) => typeof v === 'string' && v.trim() && v.length <= 30))
        || !Array.isArray(view.entryIds) || view.entryIds.length > 200 || view.entryIds.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) throw new Error('专题名称、规则或选中记录无效');
      if (!view.keywords.length && !view.types.length && !view.entryIds.length) throw new Error('请至少选择一个关键词或一条原记录');
      if (topicIds.has(view.id)) throw new Error('专题标识重复，请先整理关注项');
      topicIds.add(view.id);
      return { intent: 'topic', id: view.id, title: view.title.trim(), window: { kind: 'all' },
        keywords: [...new Set(view.keywords.map((v) => v.trim()))], types: [...new Set(view.types)], entryIds: [...new Set(view.entryIds)],
        fields: [], warning: '', question: '', candidates: [] };
    }
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
  if (event.action === 'getViews') return { ok: true, views: existing, revision, member, topics: 1 };
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
