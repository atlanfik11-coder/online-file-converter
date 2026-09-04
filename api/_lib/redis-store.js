const REDIS_URL = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
const REDIS_TOKEN = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

function isRedisConfigured() {
  return !!REDIS_URL && !!REDIS_TOKEN;
}

async function redisCommand(command) {
  if (!isRedisConfigured()) {
    throw new Error('redis_not_configured');
  }
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

async function redisGetJson(key) {
  const raw = await redisCommand(['GET', key]);
  if (!raw) return null;
  return JSON.parse(raw);
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
