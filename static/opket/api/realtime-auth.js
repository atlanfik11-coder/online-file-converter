const crypto = require('crypto');
const { isRedisConfigured, redisGetJson } = require('./_lib/redis-store');
const { verifyRegistrySessionToken } = require('./_lib/server-auth');
const { getManagedBrokerForServerDoc } = require('./_lib/broker-config');

function serverKey(serverId) {
  return `opket:server:${serverId}`;
}

function sanitizeServerId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
}

function sanitizeMemberId(value) {
  return String(value || '').trim().slice(0, 64);
}

function readSessionToken(req) {
  const authHeader = String(req.headers?.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(req.headers?.['x-opket-session'] || req.query?.sessionToken || '').trim();
}

function buildIceServers() {
  const stunServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];

  const turnUrls = String(process.env.TURN_URLS || '').trim();
  const turnAuthSecret = String(process.env.TURN_AUTH_SECRET || '').trim();
  const turnAuthTtlSeconds = Math.max(60, parseInt(process.env.TURN_AUTH_TTL_SECONDS || '43200', 10) || 43200);
  const turnUsername = String(process.env.TURN_USERNAME || '').trim();
  const turnPassword = String(process.env.TURN_PASSWORD || '').trim();

  if (!turnUrls) {
    return stunServers;
  }

  if (turnAuthSecret) {
    const username = `${Math.floor(Date.now() / 1000) + turnAuthTtlSeconds}:opket`;
    const credential = crypto
      .createHmac('sha1', turnAuthSecret)
      .update(username)
      .digest('base64');
    return [
      ...stunServers,
      {
        urls: turnUrls.split(',').map((value) => value.trim()).filter(Boolean),
        username,
        credential
      }
    ];
  }

  if (!turnUsername || !turnPassword) {
    return stunServers;
  }

  return [
    ...stunServers,
    {
      urls: turnUrls.split(',').map((value) => value.trim()).filter(Boolean),
      username: turnUsername,
      credential: turnPassword
    }
  ];
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!isRedisConfigured()) {
    return res.status(503).json({ error: 'registry_not_configured' });
  }

  const serverId = sanitizeServerId(req.query?.serverId);
  const memberId = sanitizeMemberId(req.query?.memberId);
  if (!serverId || !memberId) {
    return res.status(400).json({ error: 'missing_session_context' });
  }

  const verification = verifyRegistrySessionToken(readSessionToken(req), { serverId, memberId });
  if (!verification.ok) {
    return res.status(401).json({ error: verification.error || 'session_invalid' });
  }

  const doc = await redisGetJson(serverKey(serverId));
  if (!doc || doc.deleted) {
    return res.status(404).json({ error: 'server_not_found' });
  }

  const nonce = String(doc?.sessions?.[memberId]?.nonce || '').trim();
  if (!nonce || nonce !== verification.payload.nonce) {
    return res.status(401).json({ error: 'session_invalid' });
  }

  const iceServers = buildIceServers();

  if (!broker?.mqttBrokerUrl || !broker?.mqttUsername || !broker?.mqttPassword) {
    return res.status(200).json({
      mqttBrokerUrl: 'wss://broker.emqx.io:8084/mqtt',
      mqttUsername: '',
      mqttPassword: '',
      brokerRegion: 'primary',
      iceServers,
      turnEnabled: iceServers.length > 1
    });
  }

  return res.status(200).json({
    mqttBrokerUrl: broker.mqttBrokerUrl,
    mqttUsername: broker.mqttUsername,
    mqttPassword: broker.mqttPassword,
    brokerRegion: broker.key,
    iceServers,
    turnEnabled: iceServers.length > 1
  });
};
