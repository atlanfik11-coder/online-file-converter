const { isRedisConfigured, redisGetJson, redisScan, redisSetJson, redisSMembers, redisSRem } = require('./_lib/redis-store');
const { verifyAdminSessionToken } = require('./_lib/admin-auth');

const DELETE_TTL_SECONDS = 24 * 60 * 60;
const ADMIN_MEMBER_ACTIVE_WINDOW_MS = 18 * 1000;

function serverKey(serverId) {
  return `opket:server:${serverId}`;
}

function serverIndexKey() {
  return 'opket:server:index';
}

function sanitizeServerId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
}

function isUserFacingServerId(serverId) {
  return /^(OPKET|OPKET)-[A-Z0-9-]+$/.test(String(serverId || '').trim().toUpperCase());
}

function isAdminAuthorized(req) {
  const authHeader = String(req.headers?.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return verifyAdminSessionToken(authHeader.slice(7).trim()).ok;
  }
  const headerToken = String(req.headers?.['x-opket-admin-session'] || '').trim();
  return verifyAdminSessionToken(headerToken).ok;
}

function buildServerSummary(doc) {
  const membersMap = doc?.members && typeof doc.members === 'object' ? doc.members : {};
  const members = Object.values(membersMap).filter((member) => member && member.id);
  const totalMembers = members.length;
  const lastSeenAt = Number(doc?.lastSeenAt || 0) || 0;
  const now = Date.now();
  const activeMembers = members.filter((member) => {
    const memberLastSeenAt = Number(member?.lastSeenAt || member?.updatedAt || 0) || 0;
    if (!memberLastSeenAt) return false;
    if (member?.online === false) return false;
    return (now - memberLastSeenAt) <= ADMIN_MEMBER_ACTIVE_WINDOW_MS;
  }).length;
  const isActive = activeMembers > 0;
  const owner = members.find((member) => member.id === doc?.ownerId) || null;
  const plan = String(doc?.plan || 'standard').trim().toLowerCase() === 'unlimited' ? 'unlimited' : 'standard';
  const isUnlimited = plan === 'unlimited';
  return {
    serverId: String(doc?.serverId || '').trim().toUpperCase(),
    ownerId: String(doc?.ownerId || '').trim(),
    ownerName: String(owner?.name || '').trim(),
    ownerEmoji: String(owner?.emoji || '').trim(),
    brokerRegion: String(doc?.brokerRegion || '').trim(),
    brokerLabel: String(doc?.brokerLabel || '').trim(),
    timeZone: String(doc?.timeZone || '').trim(),
    totalMembers,
    activeMembers,
    isActive,
    createdAt: Number(doc?.createdAt || 0) || 0,
    updatedAt: Number(doc?.updatedAt || 0) || 0,
    lastSeenAt,
    plan,
    isUnlimited,
    adFree: isUnlimited || doc?.adFree === true,
    purchasedAt: Number(doc?.purchasedAt || 0) || 0,
    paymentAmount: Number(doc?.paymentAmount || 0) || 0,
    paymentCurrency: String(doc?.paymentCurrency || '').trim(),
    paymentLast4: String(doc?.paymentLast4 || '').trim(),
    paymentCardholder: String(doc?.paymentCardholder || '').trim(),
    inactiveExpiresAt: 0,
    members: members
      .map((member) => ({
        id: String(member.id || '').trim(),
        name: String(member.name || '').trim(),
        emoji: String(member.emoji || '').trim(),
        joinedAt: Number(member.joinedAt || 0) || 0,
        online: member?.online !== false,
        lastSeenAt: Number(member?.lastSeenAt || member?.updatedAt || 0) || 0
      }))
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
  };
}

async function listServerDocs() {
  const keys = [];
  const seen = new Set();
  const indexKey = serverIndexKey();

  try {
    const indexedServerIds = await redisSMembers(indexKey);
    indexedServerIds.forEach((serverId) => {
      const key = serverKey(serverId);
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    });
  } catch (error) {
    // Fall back to SCAN below when the set is empty or unavailable.
  }

  let cursor = '0';
  let rounds = 0;
  do {
    const batch = await redisScan(cursor, 'opket:server:*', 250);
    cursor = batch.cursor;
    (Array.isArray(batch.keys) ? batch.keys : []).forEach((key) => {
      if (key === indexKey) return;
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    });
    rounds += 1;
  } while (cursor !== '0' && rounds < 24);

  const docs = [];
  for (const key of keys) {
    let doc = null;
    try {
      doc = await redisGetJson(key);
    } catch (error) {
      continue;
    }
    if (!doc || doc.deleted) continue;
    await redisSetJson(key, doc).catch(() => null);
    if (!isUserFacingServerId(doc?.serverId)) continue;
    docs.push(doc);
  }
  return docs;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!isRedisConfigured()) {
    return res.status(503).json({ error: 'registry_not_configured' });
  }

  if (!isAdminAuthorized(req)) {
    return res.status(401).json({ error: 'admin_unauthorized' });
  }

  if (req.method === 'GET') {
    const docs = await listServerDocs();
    const servers = docs
      .map((doc) => buildServerSummary(doc))
      .sort((a, b) => b.totalMembers - a.totalMembers || b.lastSeenAt - a.lastSeenAt || a.serverId.localeCompare(b.serverId));

    return res.status(200).json({
      ok: true,
      totalServers: servers.length,
      totalMembers: servers.reduce((sum, server) => sum + (server.totalMembers || 0), 0),
      activeMembers: servers.reduce((sum, server) => sum + (server.activeMembers || 0), 0),
      servers
    });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const action = String(body.action || '').trim().toLowerCase();
    if (action !== 'delete') {
      return res.status(400).json({ error: 'invalid_action' });
    }

    const serverId = sanitizeServerId(body.serverId);
    if (!serverId) {
      return res.status(400).json({ error: 'missing_server_id' });
    }

    const key = serverKey(serverId);
    const doc = await redisGetJson(key);
    if (!doc || doc.deleted) {
      return res.status(404).json({ error: 'server_not_found' });
    }

    if (action === 'delete') {
      const nextDoc = {
        ...doc,
        deleted: true,
        deletedAt: Date.now(),
        deletedBy: 'admin',
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
        members: {},
        sessions: {},
        ownerId: ''
      };
      await redisSetJson(key, nextDoc, DELETE_TTL_SECONDS);
      await redisSRem(serverIndexKey(), serverId);

      return res.status(200).json({
        ok: true,
        serverId,
        deleted: true
      });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
};
