const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database({ throwOnNotFound: false });
const MEMBERS = 'members';
const INVITES = 'invites';
const FAMILIES = 'families';

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const ROLES = ['owner', 'editor', 'viewer'];

let collectionsReady;

function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = (async () => {
      for (const name of [MEMBERS, INVITES, FAMILIES]) {
        try {
          await db.createCollection(name);
        } catch (e) {
          // 已存在也会报错；后续读写仍会抛出真实的权限或连接错误。
        }
      }
    })();
  }
  return collectionsReady;
}

function rand(n) {
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

async function findByOpenid(openid) {
  const res = await db.collection(MEMBERS).where({ openid }).limit(1).get();
  return res.data[0] || null;
}

async function findByFamilyCode(code) {
  const res = await db.collection(MEMBERS).where({ family_code: code }).limit(1).get();
  return res.data[0] || null;
}

const CODE_PATTERN = /^[a-z0-9]{4,12}$/;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '无法确认微信身份' };
  // 新成员使用稳定文档 ID，创建家庭与兑换邀请共用同一事务冲突点。
  const memberId = crypto.createHash('sha256').update(OPENID).digest('hex').slice(0, 32);
  const action = event.action || 'me';

  // 读取身份、成员列表不初始化集合，避免只读调用产生数据库副作用。
  if (['create', 'redeem', 'createInvite', 'setRole', 'removeMember', 'saveProfile'].includes(action)) {
    await ensureCollections();
  }

  if (action === 'me') {
    return { ok: true, member: await findByOpenid(OPENID) };
  }

  if (action === 'create') {
    const exists = await findByOpenid(OPENID);
    if (exists) return { ok: true, member: exists };

    let code = String(event.code || '').trim().toLowerCase();
    if (code) {
      if (!CODE_PATTERN.test(code)) {
        return { ok: false, error: '家庭码用 4–12 位字母或数字' };
      }
    } else {
      code = rand(8);
    }
    // 兼容尚未建立 families 记录的既有家庭；查询异常必须中止创建。
    if (await findByFamilyCode(code)) {
      return { ok: false, error: '这个家庭码已经有人用了，换一个' };
    }

    const doc = {
      openid: OPENID,
      family_code: code,
      role: 'owner',
      name: String(event.name || '').slice(0, 12) || '我',
      created_at: Date.now(),
    };
    return db.runTransaction(async (transaction) => {
      const memberRef = transaction.collection(MEMBERS).doc(memberId);
      const current = await memberRef.get();
      if (current.data) return { ok: true, member: current.data };
      const familyRef = transaction.collection(FAMILIES).doc(code);
      const family = await familyRef.get();
      if (family.data) return { ok: false, error: '这个家庭码已经有人用了，换一个' };
      await familyRef.set({ data: { created_at: doc.created_at } });
      await memberRef.set({ data: doc });
      return { ok: true, member: Object.assign({ _id: memberId }, doc) };
    });
  }

  if (action === 'redeem') {
    const code = String(event.code || '').trim().toLowerCase();
    if (!code) return { ok: false, error: '码不能空' };

    const exists = await findByOpenid(OPENID);
    if (exists) return { ok: true, member: exists };

    const now = Date.now();
    const displayName = String(event.name || '').slice(0, 12);

    const res = await db.collection(INVITES).where({ code }).limit(1).get();
    const candidate = res.data[0];
    if (!candidate) return { ok: false, error: '邀请码不对，请向管理员重新获取' };

    return db.runTransaction(async (transaction) => {
      const memberRef = transaction.collection(MEMBERS).doc(memberId);
      const current = await memberRef.get();
      if (current.data) return { ok: true, member: current.data };
      const inviteRef = transaction.collection(INVITES).doc(candidate._id);
      const result = await inviteRef.get();
      const inv = result.data;
      if (!inv) return { ok: false, error: '邀请码不对，请向管理员重新获取' };
      if (inv.used_by) return { ok: false, error: '这个邀请码已经用过了' };
      if (inv.expires_at && inv.expires_at < now) {
        return { ok: false, error: '邀请码过期了，让管理员再发一个' };
      }

      const doc = {
        openid: OPENID,
        family_code: inv.family_code,
        role: ROLES.indexOf(inv.role) >= 0 ? inv.role : 'viewer',
        name: displayName || inv.note || '家人',
        created_at: now,
      };
      await memberRef.set({ data: doc });
      await inviteRef.update({ data: { used_by: OPENID, used_at: now } });
      return { ok: true, member: Object.assign({ _id: memberId }, doc) };
    });
  }

  const me = await findByOpenid(OPENID);
  if (!me) return { ok: false, error: '还没有被邀请加入' };

  if (action === 'getProfile') {
    try {
      const res = await db.collection(FAMILIES).where({ _id: me.family_code }).limit(1).get();
      return { ok: true, profile: res.data[0] && res.data[0].profile || null, member: me };
    } catch (err) {
      if (err.errCode === -502005) return { ok: true, profile: null, member: me };
      throw err;
    }
  }

  if (action === 'saveProfile') {
    if (me.role !== 'owner') return { ok: false, error: '只有管理员能设置宝宝档案' };
    const nickname = typeof event.nickname === 'string' ? event.nickname.trim() : '';
    const birthday = event.birthday;
    const time = typeof birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(birthday)
      ? Date.parse(birthday + 'T00:00:00Z') : NaN;
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    if (!nickname || nickname.length > 20 || !Number.isFinite(time)
      || new Date(time).toISOString().slice(0, 10) !== birthday || birthday > today || birthday < '1900-01-01'
      || !Number.isSafeInteger(event.revision) || event.revision < 0) {
      return { ok: false, error: '请填写昵称和有效生日，生日不能晚于今天' };
    }
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection(FAMILIES).doc(me.family_code);
      const { data: family } = await ref.get();
      const old = family && family.profile;
      if (old && old.nickname === nickname && old.birthday === birthday) return { ok: true, profile: old };
      const version = old ? old.revision : 0;
      if (version !== event.revision) return { ok: false, code: 'CONFLICT', error: '档案已被更新，请重新读取后修改' };
      const profile = { nickname, birthday, revision: version + 1, updated_at: Date.now() };
      if (family) await ref.update({ data: { profile } });
      else await ref.set({ data: { profile, created_at: Date.now() } });
      return { ok: true, profile };
    });
  }

  if (action === 'listMembers') {
    const res = await db.collection(MEMBERS)
      .where({ family_code: me.family_code })
      .orderBy('created_at', 'asc')
      .limit(100)
      .get();
    return { ok: true, list: res.data, meId: me._id };
  }

  if (action === 'createInvite') {
    if (me.role !== 'owner') return { ok: false, error: '只有管理员能生成邀请' };

    const role = ROLES.indexOf(event.role) >= 0 ? event.role : 'viewer';
    const doc = {
      code: rand(6),
      family_code: me.family_code,
      role,
      note: String(event.note || '').slice(0, 12),
      created_at: Date.now(),
      expires_at: Date.now() + 7 * 24 * 3600 * 1000,
      used_by: null,
    };
    await db.collection(INVITES).add({ data: doc });
    return { ok: true, invite: doc };
  }

  if (action === 'setRole') {
    if (me.role !== 'owner') return { ok: false, error: '只有管理员能改' };
    const id = String(event.id || '');
    if (!id || ROLES.indexOf(event.role) < 0) return { ok: false, error: '参数不对' };

    await db.collection(MEMBERS)
      .where({ _id: id, family_code: me.family_code })
      .update({ data: { role: event.role } });
    return { ok: true };
  }

  if (action === 'removeMember') {
    if (me.role !== 'owner') return { ok: false, error: '只有管理员能移除' };
    const id = String(event.id || '');
    if (!id) return { ok: false, error: '参数不对' };
    if (id === me._id) return { ok: false, error: '不能移除自己' };

    await db.collection(MEMBERS)
      .where({ _id: id, family_code: me.family_code })
      .remove();
    return { ok: true };
  }

  return { ok: false, error: 'unknown action' };
};
