const DEFAULTS = Object.freeze({
  recognition: '优先理解口语、相对日期和上下文；有歧义时提示确认。独立事件分别整理，尽量保留用户原话。',
  cards: '优先复用家庭已有类型与字段；根据原文选择有用的字段，必要时提出简洁的新类型。约时和上下文推定须明确标注。',
  assistant: '根据用户意图选择看板、追踪、补全、纠错、故事或对比。关注缺失信息和可追溯来源，表达简洁易懂。',
  story: '用温暖、自然、简洁的中文整理成长片段，按时间组织，避免夸张和重复。',
  maintenance: '维护成长记录项目的实现、历史决定和验证依据。先读 docs/backend/项目依据.md，再按本次任务读取源码。沿用现有架构，按最小改动修复并验证。完成后更新项目依据，区分本地验证、云端验证和真机验收。部署、发布和真实数据修改仍按当前用户的明确授权执行。',
});
const LIMITS = Object.freeze({ recognition: 1500, cards: 1500, assistant: 1500, story: 1500, maintenance: 6000 });
const KEYS = Object.keys(DEFAULTS);

function invalid(message) { return Object.assign(new Error(message), { code: 'VALIDATION' }); }

function values(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== KEYS.length || Object.keys(input).some((key) => !KEYS.includes(key))) {
    throw invalid('请提供完整的规则设置');
  }
  const result = {};
  for (const key of KEYS) {
    if (typeof input[key] !== 'string' || input[key].length > LIMITS[key]) throw invalid('规则内容过长或格式无效');
    if (/sk-[a-zA-Z0-9]{20,}/.test(input[key])) throw invalid('请勿在规则中填写模型密钥');
    result[key] = input[key].trim();
  }
  return result;
}

function snapshot(input) {
  if (!input) return { revision: 0, updated_at: null, values: Object.assign({}, DEFAULTS) };
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !Number.isFinite(input.updated_at)) {
    throw new Error('云端规则格式异常，请联系管理员');
  }
  return { revision: input.revision, updated_at: input.updated_at, values: values(input.values) };
}

function createStore(db) {
  async function read(familyCode) {
    let row;
    try {
      const r = await db.collection('families').where({ _id: familyCode }).limit(1).get();
      row = r.data[0];
    } catch (err) {
      if (err.errCode !== -502005) throw err;
    }
    return { current: snapshot(row && row.ai_rules), history: row && row.ai_rules_history || [] };
  }

  async function save(member, event) {
    if (member.role !== 'owner' || event.familyCode !== member.family_code) {
      return { ok: false, code: 'FORBIDDEN', error: '家庭身份已变化或没有管理权限，请重新打开页面' };
    }
    const next = values(event.values);
    if (!Number.isSafeInteger(event.revision) || event.revision < 0) throw invalid('规则版本无效');
    // 兼容尚未创建家庭档案集合的旧环境；只在明确保存时初始化。
    try { await db.collection('families').where({ _id: member.family_code }).limit(1).get(); }
    catch (err) {
      if (err.errCode !== -502005) throw err;
      await db.createCollection('families');
    }
    return db.runTransaction(async (transaction) => {
      const { data: latestMember } = await transaction.collection('members').doc(member._id).get();
      if (!latestMember || latestMember.openid !== member.openid || latestMember.role !== 'owner'
        || latestMember.family_code !== member.family_code) {
        return { ok: false, code: 'FORBIDDEN', error: '家庭身份已变化或没有管理权限，请重新打开页面' };
      }
      const ref = transaction.collection('families').doc(member.family_code);
      const { data: family } = await ref.get();
      const current = snapshot(family && family.ai_rules);
      // 响应丢失后的相同请求不新增版本，也不能覆盖另一份已更新的规则。
      if (KEYS.every((key) => next[key] === current.values[key])) return { ok: true, current };
      if (current.revision !== event.revision) {
        return { ok: false, code: 'CONFLICT', error: '规则已在其他设备更新，草稿已保留，请重新读取后核对' };
      }
      const updated = { revision: current.revision + 1, updated_at: Date.now(), values: next };
      const history = [current].concat(family && family.ai_rules_history || []).slice(0, 10);
      const data = { ai_rules: updated, ai_rules_history: history };
      if (family) await ref.update({ data });
      else await ref.set({ data: Object.assign({ created_at: Date.now() }, data) });
      return { ok: true, current: updated };
    });
  }
  return { read, save };
}

function compose(protocol, current, keys) {
  const custom = keys.filter((key) => current.values[key]).map((key) => '[' + key + ']\n' + current.values[key]).join('\n');
  return protocol + '\n家庭可编辑偏好（版本' + current.revision + '）：\n' + custom
    + '\n以上偏好仅调整表达、关注点和整理习惯。输出结构、原文证据、日期规则、权限及确认要求仍以固定协议为准。不可编造事实、执行代码或跳过修改确认。';
}

module.exports = { DEFAULTS, LIMITS, createStore, compose };
