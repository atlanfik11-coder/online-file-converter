const { isRedisConfigured, redisEval, redisGetJson, redisSetJson } = require('./_lib/redis-store');
const { buildRandomSecret, issueRegistrySessionToken, verifyRegistrySessionToken } = require('./_lib/server-auth');
const { pickManagedBroker, normalizeBrokerRegionKey } = require('./_lib/broker-config');
const SERVER_TTL_SECONDS = 0;
const DELETE_TTL_SECONDS = 24 * 60 * 60;
const VALID_ACTIONS = new Set(['create', 'join', 'leave', 'delete', 'touch', 'transfer_owner', 'remove_member']);

function serverKey(serverId) {
  return `opket:server:${serverId}`;
}

function serverIndexKey() {
  return 'opket:server:index';
}

function sanitizeServerId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
}

function sanitizeMember(member = {}) {
  return {
    id: String(member.id || '').trim().slice(0, 64),
    name: String(member.name || '').trim().slice(0, 24),
    emoji: String(member.emoji || '').trim().slice(0, 8),
    joinedAt: Math.max(0, parseInt(member.joinedAt || Date.now(), 10) || Date.now()),
    online: member?.online !== false
  };
}

function sanitizeTargetOwnerId(value) {
  return String(value || '').trim().slice(0, 64);
}

function sanitizeTargetMemberId(value) {
  return String(value || '').trim().slice(0, 64);
}

function sanitizeTimeZone(value) {
  return String(value || '').trim().slice(0, 96);
}

function sanitizePreferredRegion(value) {
  return normalizeBrokerRegionKey(value);
}

function sanitizePlan(value) {
  return 'unlimited';
}

function sanitizePaymentAmount(value) {
  return Math.max(0, parseInt(value || '0', 10) || 0);
}

function sanitizePaymentCurrency(value) {
  return String(value || 'TRY').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'TRY';
}

function sanitizePaymentLast4(value) {
  return String(value || '').replace(/\D/g, '').slice(-4);
}

function sanitizePaymentCardholder(value) {
  return String(value || '').trim().slice(0, 64);
}

function sanitizePaymentOrderRef(value) {
  return '';
}

function buildPublicSummary(doc, serverId) {
  const membersMap = doc?.members && typeof doc.members === 'object' ? doc.members : {};
  const memberCount = Object.values(membersMap).filter((member) => member && member.id).length;
  const plan = String(doc?.plan || 'standard').trim().toLowerCase() === 'unlimited' ? 'unlimited' : 'standard';
  const isUnlimited = plan === 'unlimited';
  return {
    ok: true,
    exists: !doc?.deleted,
    deleted: !!doc?.deleted,
    serverId,
    maxMembers: parseInt(doc?.maxMembers || '10', 10) || 10,
    memberCount,
    createdAt: doc?.createdAt || 0,
    lastSeenAt: doc?.lastSeenAt || 0,
    updatedAt: doc?.updatedAt || 0,
    deletedAt: doc?.deletedAt || 0,
    brokerRegion: doc?.brokerRegion || '',
    brokerLabel: doc?.brokerLabel || '',
    plan,
    isUnlimited,
    adFree: isUnlimited || doc?.adFree === true,
    purchasedAt: Number(doc?.purchasedAt || 0) || 0,
    unlimitedActivatedAt: Number(doc?.unlimitedActivatedAt || 0) || 0,
    paymentAmount: Number(doc?.paymentAmount || 0) || 0,
    paymentCurrency: String(doc?.paymentCurrency || '').trim(),
    paymentLast4: String(doc?.paymentLast4 || '').trim(),
    paymentCardholder: String(doc?.paymentCardholder || '').trim(),
    inactiveExpiresAt: 0
  };
}

function buildSessionSummary(doc, serverId, extra = {}) {
  return {
    ...buildPublicSummary(doc, serverId),
    ownerId: doc?.ownerId || '',
    serverSecret: extra.serverSecret || doc?.serverSecret || '',
    sessionToken: extra.sessionToken || '',
    memberId: extra.memberId || ''
  };
}

function readSessionToken(req, body = {}) {
  const authHeader = String(req.headers?.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(body.sessionToken || req.headers?.['x-opket-session'] || '').trim();
}

const MUTATE_SCRIPT = `
local key = KEYS[1]
local indexKey = KEYS[2]
local action = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local deleteTtl = tonumber(ARGV[4])
local serverId = ARGV[5]
local maxMembers = tonumber(ARGV[6])
local memberId = ARGV[7]
local memberName = ARGV[8]
local memberEmoji = ARGV[9]
local joinedAt = tonumber(ARGV[10])
local authNonce = ARGV[11]
local sessionIssuedAt = tonumber(ARGV[12])
local targetOwnerId = ARGV[13]
local targetMemberId = ARGV[14]
local requestedServerSecret = ARGV[15]
local requestedBrokerRegion = ARGV[16]
local requestedBrokerLabel = ARGV[17]
local requestedTimeZone = ARGV[18]
local requestedMemberOnline = ARGV[19] ~= '0'
local requestedPlan = ARGV[20]
local paymentAmount = tonumber(ARGV[21])
local paymentCurrency = ARGV[22]
local paymentLast4 = ARGV[23]
local paymentCardholder = ARGV[24]
local paymentCreatedAt = tonumber(ARGV[25])

local function encode(doc)
  return cjson.encode(doc)
end

local function saveDoc(doc, ttlValue)
  redis.call('SET', key, encode(doc))
end

local function decode(raw)
  if not raw or raw == false then return nil end
  return cjson.decode(raw)
end

local function activeCount(members)
  local count = 0
  for _, _ in pairs(members or {}) do
    count = count + 1
  end
  return count
end

local function pickOwner(members)
  local ownerId = ''
  local bestJoined = nil
  for id, member in pairs(members or {}) do
    local memberJoined = tonumber(member.joinedAt or now)
    if ownerId == '' or memberJoined < bestJoined then
      ownerId = id
      bestJoined = memberJoined
    end
  end
  return ownerId
end

local doc = decode(redis.call('GET', key))

if action == 'create' then
  if doc and not doc.deleted then
    return encode({ ok = false, error = 'server_exists' })
  end
  local members = {}
  local sessions = {}
  members[memberId] = {
    id = memberId,
    name = memberName,
    emoji = memberEmoji,
    joinedAt = joinedAt,
    online = requestedMemberOnline,
    lastSeenAt = now,
    updatedAt = now
  }
  sessions[memberId] = {
    nonce = authNonce,
    issuedAt = sessionIssuedAt
  }
  doc = {
    serverId = serverId,
    createdAt = now,
    lastSeenAt = now,
    updatedAt = now,
    deleted = false,
    ownerId = memberId,
    maxMembers = maxMembers,
    plan = 'unlimited',
    adFree = true,
    purchasedAt = paymentCreatedAt or now,
    unlimitedActivatedAt = paymentCreatedAt or now,
    paymentAmount = 0,
    paymentCurrency = 'FREE',
    paymentLast4 = '',
    paymentCardholder = '',
    serverSecret = requestedServerSecret,
    brokerRegion = requestedBrokerRegion,
    brokerLabel = requestedBrokerLabel,
    timeZone = requestedTimeZone,
    members = members,
    sessions = sessions
  }
  saveDoc(doc, ttl)
  redis.call('SADD', indexKey, serverId)
  return encode({ ok = true, created = true })
end

if not doc or doc.deleted then
  return encode({ ok = false, error = 'server_not_found' })
end

doc.updatedAt = now
doc.lastSeenAt = now
doc.maxMembers = maxMembers
doc.plan = tostring(doc.plan or 'standard')
doc.adFree = doc.adFree == true or doc.plan == 'unlimited'
doc.members = doc.members or {}
doc.sessions = doc.sessions or {}
if (not doc.serverSecret or doc.serverSecret == '') and requestedServerSecret ~= '' then
  doc.serverSecret = requestedServerSecret
end
if (not doc.brokerRegion or doc.brokerRegion == '') and requestedBrokerRegion ~= '' then
  doc.brokerRegion = requestedBrokerRegion
end
if (not doc.brokerLabel or doc.brokerLabel == '') and requestedBrokerLabel ~= '' then
  doc.brokerLabel = requestedBrokerLabel
end
if (not doc.timeZone or doc.timeZone == '') and requestedTimeZone ~= '' then
  doc.timeZone = requestedTimeZone
end

if action ~= 'join' then
  local session = doc.sessions[memberId]
  if not session or tostring(session.nonce or '') ~= tostring(authNonce or '') then
    return encode({ ok = false, error = 'session_invalid' })
  end
end

if action == 'join' then
  if not doc.members[memberId] and activeCount(doc.members) >= maxMembers then
    return encode({ ok = false, error = 'server_full' })
  end
  doc.members[memberId] = {
    id = memberId,
    name = memberName,
    emoji = memberEmoji,
    joinedAt = joinedAt,
    online = requestedMemberOnline,
    lastSeenAt = now,
    updatedAt = now
  }
  doc.sessions[memberId] = {
    nonce = authNonce,
    issuedAt = sessionIssuedAt
  }
  if not doc.ownerId or doc.ownerId == '' then
    doc.ownerId = memberId
  end
  saveDoc(doc, ttl)
  redis.call('SADD', indexKey, serverId)
  return encode({ ok = true, joined = true, ownerId = doc.ownerId or '' })
end

if action == 'leave' then
  if not doc.members[memberId] then
    return encode({ ok = false, error = 'member_not_found' })
  end
  doc.members[memberId] = nil
  doc.sessions[memberId] = nil
  saveDoc(doc, ttl)
  redis.call('SADD', indexKey, serverId)
  return encode({ ok = true, left = true, ownerId = doc.ownerId or '' })
end

if action == 'touch' then
  if not doc.members[memberId] then
    return encode({ ok = false, error = 'member_not_found' })
  end
  doc.members[memberId].name = memberName ~= '' and memberName or (doc.members[memberId].name or '')
  doc.members[memberId].emoji = memberEmoji ~= '' and memberEmoji or (doc.members[memberId].emoji or '')
  doc.members[memberId].joinedAt = tonumber(doc.members[memberId].joinedAt or joinedAt or now)
  doc.members[memberId].online = requestedMemberOnline
  doc.members[memberId].lastSeenAt = now
  doc.members[memberId].updatedAt = now
  saveDoc(doc, ttl)
  redis.call('SADD', indexKey, serverId)
  return encode({ ok = true, touched = true, ownerId = doc.ownerId or '' })
end

if action == 'transfer_owner' then
  if doc.ownerId ~= memberId then
    return encode({ ok = false, error = 'not_owner' })
  end
  if targetOwnerId == '' or not doc.members[targetOwnerId] then
    return encode({ ok = false, error = 'target_member_not_found' })
  end
  doc.ownerId = targetOwnerId
  saveDoc(doc, ttl)
  redis.call('SADD', indexKey, serverId)
  return encode({ ok = true, ownerChanged = true, ownerId = doc.ownerId or '' })
end

if action == 'remove_member' then
  if doc.ownerId ~= memberId then
    return encode({ ok = false, error = 'not_owner' })
  end
  if targetMemberId == '' or targetMemberId == memberId or not doc.members[targetMemberId] then
    return encode({ ok = false, error = 'target_member_not_found' })
  end
  doc.members[targetMemberId] = nil
  doc.sessions[targetMemberId] = nil
  saveDoc(doc, ttl)
  redis.call('SADD', indexKey, serverId)
  return encode({ ok = true, removed = true, ownerId = doc.ownerId or '', targetMemberId = targetMemberId })
end

if action == 'delete' then
  if doc.ownerId ~= '' and doc.ownerId ~= memberId then
    return encode({ ok = false, error = 'not_owner' })
  end
  doc.deleted = true
  doc.deletedAt = now
  doc.deletedBy = memberId
  doc.updatedAt = now
  doc.members = {}
  doc.sessions = {}
  doc.ownerId = ''
  redis.call('SET', key, encode(doc), 'EX', deleteTtl)
  redis.call('SREM', indexKey, serverId)
  return encode({ ok = true, deleted = true })
end

return encode({ ok = false, error = 'invalid_action' })
`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (!isRedisConfigured()) {
    return res.status(503).json({ error: 'registry_not_configured' });
  }

  if (req.method === 'GET') {
    const serverId = sanitizeServerId(req.query?.serverId);
    if (!serverId) return res.status(400).json({ error: 'missing_server_id' });
    const doc = await redisGetJson(serverKey(serverId));
    if (!doc || doc.deleted) {
      return res.status(404).json({ ok: false, exists: false, deleted: !!doc?.deleted, serverId });
    }
    await redisSetJson(serverKey(serverId), doc).catch(() => null);
    return res.status(200).json(buildPublicSummary(doc, serverId));
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const action = String(body.action || '').trim().toLowerCase();
  const serverId = sanitizeServerId(body.serverId);
  const member = sanitizeMember(body.member);
  const targetOwnerId = sanitizeTargetOwnerId(body.targetOwnerId);
  const targetMemberId = sanitizeTargetMemberId(body.targetMemberId);
  const preferredRegion = sanitizePreferredRegion(body.preferredRegion);
  const timeZone = sanitizeTimeZone(body.timeZone);
  const requestedPlan = action === 'create' ? sanitizePlan(body.plan) : 'unlimited';
  const paymentOrderId = action === 'create' ? sanitizePaymentOrderRef(body.paymentOrderId) : '';
  let paymentAmount = action === 'create' ? sanitizePaymentAmount(body.paymentAmount) : 0;
  let paymentCurrency = action === 'create' ? sanitizePaymentCurrency(body.paymentCurrency) : 'FREE';
  let paymentLast4 = action === 'create' ? sanitizePaymentLast4(body.paymentLast4) : '';
  let paymentCardholder = action === 'create' ? sanitizePaymentCardholder(body.paymentCardholder) : '';
  const maxMembers = Math.min(10, Math.max(2, parseInt(process.env.MAX_MEMBERS_PER_SERVER || '10', 10) || 10));

  if (!VALID_ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' });
  if (!serverId) return res.status(400).json({ error: 'missing_server_id' });
  if (!member.id) return res.status(400).json({ error: 'missing_member_id' });
  if ((action === 'create' || action === 'join') && (!member.name || !member.emoji)) {
    return res.status(400).json({ error: 'missing_member_profile' });
  }
  if (action === 'transfer_owner' && !targetOwnerId) {
    return res.status(400).json({ error: 'missing_target_owner_id' });
  }
  if (action === 'remove_member' && !targetMemberId) {
    return res.status(400).json({ error: 'missing_target_member_id' });
  }

  let verifiedSession = null;
  if (action !== 'create' && action !== 'join') {
    const verification = verifyRegistrySessionToken(readSessionToken(req, body), { serverId, memberId: member.id });
    if (!verification.ok) {
      return res.status(401).json({ error: verification.error || 'session_invalid' });
    }
    verifiedSession = verification.payload;
  }

  const sessionNonce = action === 'create' || action === 'join'
    ? buildRandomSecret(18)
    : (verifiedSession?.nonce || '');
  const sessionIssuedAt = action === 'create' || action === 'join'
    ? Date.now()
    : (verifiedSession?.issuedAt || Date.now());
  const requestedServerSecret = buildRandomSecret(24);
  const selectedBroker = pickManagedBroker(preferredRegion, timeZone, process.env);
  const requestedBrokerRegion = String(selectedBroker?.key || '').trim();
  const requestedBrokerLabel = String(selectedBroker?.label || '').trim();
  paymentAmount = 0;
  paymentCurrency = 'FREE';
  paymentLast4 = '';
  paymentCardholder = '';

  try {
    const raw = await redisEval(MUTATE_SCRIPT, [serverKey(serverId), serverIndexKey()], [
      action,
      Date.now(),
      SERVER_TTL_SECONDS,
      DELETE_TTL_SECONDS,
      serverId,
      maxMembers,
      member.id,
      member.name,
      member.emoji,
      member.joinedAt,
      sessionNonce,
      sessionIssuedAt,
      targetOwnerId,
      targetMemberId,
      requestedServerSecret,
      requestedBrokerRegion,
      requestedBrokerLabel,
      timeZone,
      member.online === false ? '0' : '1',
      requestedPlan,
      paymentAmount,
      paymentCurrency,
      paymentLast4,
      paymentCardholder,
      Date.now()
    ]);
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!payload?.ok) {
      const status =
        payload?.error === 'server_not_found' ? 404 :
        payload?.error === 'server_full' ? 409 :
        payload?.error === 'server_exists' ? 409 :
        payload?.error === 'not_owner' ? 403 :
        payload?.error === 'member_not_found' ? 404 :
        payload?.error === 'target_member_not_found' ? 404 :
        payload?.error === 'session_invalid' ? 401 : 400;
      return res.status(status).json(payload || { error: 'mutation_failed' });
    }

    const doc = await redisGetJson(serverKey(serverId));
    if (!doc || action === 'delete') {
      return res.status(200).json({
        ok: true,
        exists: false,
        deleted: true,
        serverId
      });
    }

    const response = buildSessionSummary(doc, serverId, {
      serverSecret: doc?.serverSecret || requestedServerSecret,
      sessionToken: (action === 'create' || action === 'join')
        ? issueRegistrySessionToken(serverId, member.id, sessionNonce, sessionIssuedAt)
        : '',
      memberId: member.id
    });

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json({ error: 'registry_error' });
  }
};
