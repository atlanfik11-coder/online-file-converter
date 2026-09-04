const REDIS_URL = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
const REDIS_TOKEN = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

global.OPKET_MEM_STORE = global.OPKET_MEM_STORE || {
  docs: new Map(),
  sets: new Map()
};

function isRedisConfigured() {
  return true;
}

async function redisCommand(command) {
  if (REDIS_URL && REDIS_TOKEN) {
    const response = await fetch(REDIS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error || `redis_http_${response.status}`);
    }
    return payload?.result;
  }

  // --- In-Memory Fallback for Vercel / Local Environments ---
  const cmd = String(command[0] || '').toUpperCase();
  if (cmd === 'GET') {
    const key = command[1];
    return global.OPKET_MEM_STORE.docs.get(key) || null;
  }
  if (cmd === 'SET') {
    const key = command[1];
    const val = command[2];
    global.OPKET_MEM_STORE.docs.set(key, String(val));
    return 'OK';
  }
  if (cmd === 'SCAN') {
    const keys = Array.from(global.OPKET_MEM_STORE.docs.keys()).filter(k => k.startsWith('opket:server:') && k !== 'opket:server:index');
    return ['0', keys];
  }
  if (cmd === 'SMEMBERS') {
    const key = command[1];
    const set = global.OPKET_MEM_STORE.sets.get(key);
    return set ? Array.from(set) : [];
  }
  if (cmd === 'SADD') {
    const key = command[1];
    const val = command[2];
    let set = global.OPKET_MEM_STORE.sets.get(key);
    if (!set) {
      set = new Set();
      global.OPKET_MEM_STORE.sets.set(key, set);
    }
    set.add(val);
    return 1;
  }
  if (cmd === 'SREM') {
    const key = command[1];
    const set = global.OPKET_MEM_STORE.sets.get(key);
    if (set) {
      for (let i = 2; i < command.length; i++) {
        set.delete(command[i]);
      }
    }
    return 1;
  }
  if (cmd === 'EVAL') {
    const keys = [command[2], command[3]];
    const action = command[4];
    const now = Number(command[5]) || Date.now();
    const serverId = command[8];
    const maxMembers = Number(command[9]) || 10;
    const memberId = command[10];
    const memberName = command[11];
    const memberEmoji = command[12];
    const joinedAt = Number(command[13]) || now;

    const key = keys[0];
    const indexKey = keys[1];

    let raw = global.OPKET_MEM_STORE.docs.get(key);
    let doc = raw ? JSON.parse(raw) : null;

    if (action === 'create') {
      if (doc && !doc.deleted) {
        return JSON.stringify({ ok: false, error: 'server_exists' });
      }
      doc = {
        serverId,
        createdAt: now,
        lastSeenAt: now,
        updatedAt: now,
        deleted: false,
        ownerId: memberId,
        maxMembers,
        plan: 'unlimited',
        adFree: true,
        members: {
          [memberId]: { id: memberId, name: memberName, emoji: memberEmoji, joinedAt, online: true, lastSeenAt: now, updatedAt: now }
        },
        sessions: { [memberId]: { nonce: command[14], issuedAt: now } }
      };
      global.OPKET_MEM_STORE.docs.set(key, JSON.stringify(doc));
      let idxSet = global.OPKET_MEM_STORE.sets.get(indexKey);
      if (!idxSet) { idxSet = new Set(); global.OPKET_MEM_STORE.sets.set(indexKey, idxSet); }
      idxSet.add(serverId);
      return JSON.stringify({ ok: true, created: true });
    }

    if (!doc || doc.deleted) {
      return JSON.stringify({ ok: false, error: 'server_not_found' });
    }

    doc.updatedAt = now;
    doc.lastSeenAt = now;
    doc.members = doc.members || {};
    doc.sessions = doc.sessions || {};

    if (action === 'join') {
      const count = Object.keys(doc.members).length;
      if (!doc.members[memberId] && count >= maxMembers) {
        return JSON.stringify({ ok: false, error: 'server_full' });
      }
      doc.members[memberId] = { id: memberId, name: memberName, emoji: memberEmoji, joinedAt, online: true, lastSeenAt: now, updatedAt: now };
      if (!doc.ownerId) doc.ownerId = memberId;
      global.OPKET_MEM_STORE.docs.set(key, JSON.stringify(doc));
      let idxSet = global.OPKET_MEM_STORE.sets.get(indexKey);
      if (!idxSet) { idxSet = new Set(); global.OPKET_MEM_STORE.sets.set(indexKey, idxSet); }
      idxSet.add(serverId);
      return JSON.stringify({ ok: true, joined: true, ownerId: doc.ownerId });
    }

    if (action === 'leave') {
      delete doc.members[memberId];
      global.OPKET_MEM_STORE.docs.set(key, JSON.stringify(doc));
      return JSON.stringify({ ok: true, left: true, ownerId: doc.ownerId });
    }

    if (action === 'touch') {
      if (doc.members[memberId]) {
        doc.members[memberId].name = memberName || doc.members[memberId].name;
        doc.members[memberId].emoji = memberEmoji || doc.members[memberId].emoji;
        doc.members[memberId].online = command[22] !== '0';
        doc.members[memberId].lastSeenAt = now;
      } else {
        doc.members[memberId] = { id: memberId, name: memberName, emoji: memberEmoji, joinedAt, online: true, lastSeenAt: now, updatedAt: now };
      }
      global.OPKET_MEM_STORE.docs.set(key, JSON.stringify(doc));
      return JSON.stringify({ ok: true, touched: true, ownerId: doc.ownerId });
    }

    if (action === 'transfer_owner') {
      const targetOwnerId = command[16];
      if (doc.members[targetOwnerId]) {
        doc.ownerId = targetOwnerId;
        global.OPKET_MEM_STORE.docs.set(key, JSON.stringify(doc));
        return JSON.stringify({ ok: true, ownerChanged: true, ownerId: doc.ownerId });
      }
      return JSON.stringify({ ok: false, error: 'target_member_not_found' });
    }

    if (action === 'remove_member') {
      const targetMemberId = command[17];
      delete doc.members[targetMemberId];
      global.OPKET_MEM_STORE.docs.set(key, JSON.stringify(doc));
      return JSON.stringify({ ok: true, removed: true, ownerId: doc.ownerId, targetMemberId });
    }

    if (action === 'delete') {
      doc.deleted = true;
      doc.deletedAt = now;
      doc.members = {};
      global.OPKET_MEM_STORE.docs.set(key, JSON.stringify(doc));
      let idxSet = global.OPKET_MEM_STORE.sets.get(indexKey);
      if (idxSet) idxSet.delete(serverId);
      return JSON.stringify({ ok: true, deleted: true });
    }
  }
  return null;
}

async function redisGetJson(key) {
  const raw = await redisCommand(['GET', key]);
  if (!raw) return null;
  return typeof raw === 'object' ? raw : JSON.parse(raw);
}

async function redisGet(key) {
  return redisCommand(['GET', key]);
}

async function redisSet(key, value, ttlSeconds = 0) {
  const command = ['SET', key, String(value)];
  if (ttlSeconds > 0) command.push('EX', String(ttlSeconds));
  return redisCommand(command);
}

async function redisSetJson(key, value, ttlSeconds = 0) {
  return redisSet(key, JSON.stringify(value), ttlSeconds);
}

async function redisEval(script, keys = [], args = []) {
  return redisCommand(['EVAL', script, String(keys.length), ...keys, ...args.map(value => String(value))]);
}

async function redisScan(cursor = '0', pattern = '', count = 200) {
  const command = ['SCAN', String(cursor || '0')];
  if (pattern) command.push('MATCH', String(pattern));
  if (count > 0) command.push('COUNT', String(count));
  const result = await redisCommand(command);
  const nextCursor = Array.isArray(result) ? String(result[0] || '0') : '0';
  const keys = Array.isArray(result?.[1]) ? result[1] : [];
  return { cursor: nextCursor, keys };
}

async function redisSMembers(key) {
  const result = await redisCommand(['SMEMBERS', String(key)]);
  return Array.isArray(result) ? result : [];
}

async function redisSRem(key, ...values) {
  const normalized = values
    .flat()
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!normalized.length) return 0;
  return redisCommand(['SREM', String(key), ...normalized]);
}

module.exports = {
  isRedisConfigured,
  redisCommand,
  redisEval,
  redisGet,
  redisGetJson,
  redisScan,
  redisSRem,
  redisSMembers,
  redisSet,
  redisSetJson
};
