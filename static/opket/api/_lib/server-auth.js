const crypto = require('crypto');
const { getManagedBrokerEntries } = require('./broker-config');

function getSessionSecret() {
  const configured = String(process.env.SERVER_SESSION_SECRET || '').replace(/\\r|\\n|\r|\n/g, '').trim();
  if (configured) return configured;

  const brokerFallback = getManagedBrokerEntries(process.env)
    .flatMap((broker) => [broker.mqttPassword, broker.mqttBrokerUrl])
    .filter(Boolean)
    .join('|');

  const fallback = [
    process.env.KV_REST_API_TOKEN,
    process.env.UPSTASH_REDIS_REST_TOKEN,
    brokerFallback,
    process.env.MQTT_PASSWORD,
    process.env.MQTT_BROKER_URL
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('|');

  return fallback || 'opket-dev-session-secret';
}

function getSessionTtlMs() {
  const configured = Math.max(60, parseInt(process.env.SERVER_SESSION_TTL_SECONDS || '43200', 10) || 43200);
  return configured * 1000;
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch (error) {
    return false;
  }
}

function signValue(value) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(String(value || ''))
    .digest('base64url');
}

function buildRandomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function issueRegistrySessionToken(serverId, memberId, nonce, issuedAt = Date.now()) {
  const normalizedIssuedAt = Math.max(0, parseInt(issuedAt || Date.now(), 10) || Date.now());
  const payload = toBase64Url(JSON.stringify({
    v: 2,
    serverId: String(serverId || '').trim().toUpperCase(),
    memberId: String(memberId || '').trim(),
    nonce: String(nonce || '').trim(),
    issuedAt: normalizedIssuedAt,
    expiresAt: normalizedIssuedAt + getSessionTtlMs()
  }));
  const signature = signValue(payload);
  return `op2.${payload}.${signature}`;
}

function verifyRegistrySessionToken(token, options = {}) {
  const value = String(token || '').trim();
  if (!value) return { ok: false, error: 'missing_session_token' };

  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'op2') {
    return { ok: false, error: 'invalid_session_token' };
  }

  const payloadPart = parts[1];
  const signature = parts[2];
  if (!safeEqual(signature, signValue(payloadPart))) {
    return { ok: false, error: 'invalid_session_signature' };
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadPart));
    const serverId = String(payload?.serverId || '').trim().toUpperCase();
    const memberId = String(payload?.memberId || '').trim();
    const nonce = String(payload?.nonce || '').trim();
    const issuedAt = Math.max(0, parseInt(payload?.issuedAt || 0, 10) || 0);
    const expiresAt = Math.max(0, parseInt(payload?.expiresAt || 0, 10) || 0);

    if (!serverId || !memberId || !nonce || !issuedAt || !expiresAt) {
      return { ok: false, error: 'invalid_session_payload' };
    }
    if (Date.now() >= expiresAt) {
      return { ok: false, error: 'session_expired' };
    }
    if (options.serverId && serverId !== String(options.serverId || '').trim().toUpperCase()) {
      return { ok: false, error: 'session_server_mismatch' };
    }
    if (options.memberId && memberId !== String(options.memberId || '').trim()) {
      return { ok: false, error: 'session_member_mismatch' };
    }

    return {
      ok: true,
      payload: {
        serverId,
        memberId,
        nonce,
        issuedAt,
        expiresAt
      }
    };
  } catch (error) {
    return { ok: false, error: 'invalid_session_payload' };
  }
}

module.exports = {
  buildRandomSecret,
  issueRegistrySessionToken,
  verifyRegistrySessionToken
};
