const crypto = require('crypto');
const { isRedisConfigured, redisEval, redisGet, redisSetJson } = require('./_lib/redis-store');
const {
  fetchVideoDetails,
  shouldKeepMusicCandidate,
  normalizeMusicTrack,
  dedupeNormalizedMusicTracks
} = require('./_lib/youtube-music-filter');
const { fetchYouTubeWebResults } = require('./_lib/youtube-web-search');
const {
  resolveMusicLanguage,
  getMusicRegionCode,
  trackMatchesMusicLanguage,
  stampTracksLanguage
} = require('./_lib/music-language');

const BLOCKED_TERMS = [
  'porno', 'porn', 'sex', 'seks', 'nsfw', 'nude', 'nudity', 'ciplak',
  'onlyfans', 'fetish', 'escort', 'escorts', 'fuhus', 'ifsa', '18+', '18 plus',
  'gore', 'rape', 'tecavuz', 'incest', 'bestiality', 'zoophilia', 'pedophile', 'pedofili'
];

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const QUERY_CACHE_TTL_MS = 2 * 60 * 1000;
const SEARCH_CACHE_VERSION = 'v4';
const CACHE_CONTROL = 's-maxage=120, stale-while-revalidate=600';
const rateBucket = new Map();
const queryCache = new Map();
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, ttl)
end
local ttlLeft = redis.call('TTL', key)
return cjson.encode({ current = current, ttl = ttlLeft, allowed = current <= limit })
`;

function containsBlockedTerm(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s+]/g, '');
  return BLOCKED_TERMS.some((term) => normalized.includes(term));
}

function looksMusicSafe(item) {
  const title = String(item?.snippet?.title || '').toLowerCase();
  const channel = String(item?.snippet?.channelTitle || '').toLowerCase();
  return !containsBlockedTerm(`${title} ${channel}`);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return String(req.socket?.remoteAddress || req.headers['x-real-ip'] || 'unknown');
}

function pruneMap(map, maxAgeMs, now) {
  for (const [key, value] of map.entries()) {
    if (!value || (now - value.ts) > maxAgeMs) map.delete(key);
  }
}

function takeRateLimitTokenMemory(ip, now) {
  pruneMap(rateBucket, RATE_LIMIT_WINDOW_MS, now);
  const current = rateBucket.get(ip);
  if (!current || (now - current.ts) > RATE_LIMIT_WINDOW_MS) {
    const next = { ts: now, count: 1 };
    rateBucket.set(ip, next);
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }
  if (current.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: current.ts + RATE_LIMIT_WINDOW_MS };
  }
  current.count += 1;
  return { allowed: true, remaining: Math.max(0, RATE_LIMIT_MAX - current.count), resetAt: current.ts + RATE_LIMIT_WINDOW_MS };
}

async function takeRateLimitToken(ip, now) {
  if (!isRedisConfigured()) {
    return takeRateLimitTokenMemory(ip, now);
  }

  const windowSeconds = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
  const key = `opket:music:rl:${crypto.createHash('sha1').update(ip).digest('hex')}`;
  try {
    const raw = await redisEval(RATE_LIMIT_SCRIPT, [key], [RATE_LIMIT_MAX, windowSeconds]);
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const current = Math.max(0, parseInt(payload?.current || '0', 10) || 0);
    const ttlSeconds = Math.max(0, parseInt(payload?.ttl || '0', 10) || 0);
    const allowed = !!payload?.allowed;
    return {
      allowed,
      remaining: allowed ? Math.max(0, RATE_LIMIT_MAX - current) : 0,
      resetAt: now + (ttlSeconds * 1000)
    };
  } catch (error) {
    return takeRateLimitTokenMemory(ip, now);
  }
}

function readCachedQueryMemory(query, now) {
  pruneMap(queryCache, QUERY_CACHE_TTL_MS, now);
  const cached = queryCache.get(query);
  if (!cached || (now - cached.ts) > QUERY_CACHE_TTL_MS) return null;
  return cached.payload;
}

async function readCachedQuery(query, now) {
  if (!isRedisConfigured()) {
    return readCachedQueryMemory(query, now);
  }

  const key = `opket:music:cache:${crypto.createHash('sha1').update(query).digest('hex')}`;
  try {
    const raw = await redisGet(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return readCachedQueryMemory(query, now);
  }
}

function writeCachedQueryMemory(query, payload, now) {
  queryCache.set(query, { ts: now, payload });
}

async function writeCachedQuery(query, payload, now) {
  if (!isRedisConfigured()) {
    writeCachedQueryMemory(query, payload, now);
    return;
  }

  const key = `opket:music:cache:${crypto.createHash('sha1').update(query).digest('hex')}`;
  try {
    await redisSetJson(key, payload, Math.ceil(QUERY_CACHE_TTL_MS / 1000));
  } catch (error) {
    writeCachedQueryMemory(query, payload, now);
  }
}

async function fetchFallbackSearchResults(query, now, lang, regionCode) {
  const results = await fetchYouTubeWebResults(query, { limit: 8, lang, region: regionCode });
  return dedupeNormalizedMusicTracks(
    results
      .filter((item) => !containsBlockedTerm(`${item?.title || ''} ${item?.channel || ''}`))
      .filter((item) => trackMatchesMusicLanguage(item, lang))
  ).map((item) => ({ ...item, addedAt: now, lang }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const now = Date.now();
  const rate = await takeRateLimitToken(getClientIp(req), now);
  res.setHeader('Cache-Control', CACHE_CONTROL);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(rate.resetAt));

  if (!rate.allowed) {
    return res.status(429).json({ error: 'rate_limited', retryAfterMs: Math.max(0, rate.resetAt - now) });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'owner_config_required' });
  }

  const rawQuery = typeof req.query?.q === 'string' ? req.query.q : '';
  const q = rawQuery.trim().slice(0, 120);
  const requestedLang = typeof req.query?.lang === 'string' ? req.query.lang.trim().slice(0, 8) : '';
  if (!q) {
    return res.status(400).json({ error: 'missing_query' });
  }
  if (containsBlockedTerm(q)) {
    return res.status(400).json({ error: 'query_blocked' });
  }

  const resolvedLanguage = resolveMusicLanguage({ requestedLang, text: q, fallback: 'tr' });
  const regionCode = getMusicRegionCode(resolvedLanguage);
  const cacheKey = `${SEARCH_CACHE_VERSION}|${resolvedLanguage}|${q.toLowerCase()}`;
  const cached = await readCachedQuery(cacheKey, now);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached);
  }

  const params = new URLSearchParams({
    part: 'snippet',
    maxResults: '18',
    q,
    type: 'video',
    videoEmbeddable: 'true',
    videoCategoryId: '10',
    safeSearch: 'strict',
    relevanceLanguage: resolvedLanguage,
    regionCode,
    key: apiKey
  });

  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      const fallbackResults = await fetchFallbackSearchResults(q, now, resolvedLanguage, regionCode).catch(() => []);
      if (fallbackResults.length) {
        const responsePayload = { language: resolvedLanguage, results: stampTracksLanguage(fallbackResults, resolvedLanguage) };
        await writeCachedQuery(cacheKey, responsePayload, now);
        res.setHeader('X-Cache', 'MISS-FALLBACK');
        return res.status(200).json(responsePayload);
      }
      return res.status(response.status).json({
        error: 'youtube_search_failed',
        details: payload?.error?.message || 'upstream_error'
      });
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    const detailsMap = await fetchVideoDetails(apiKey, items.map((item) => item?.id?.videoId));
    const results = dedupeNormalizedMusicTracks(items
      .filter((item) => looksMusicSafe(item))
      .filter((item) => shouldKeepMusicCandidate(item, detailsMap?.get(String(item?.id?.videoId || '').trim()), {
        requireMusicCategory: true
      }))
      .map((item) => normalizeMusicTrack(item, detailsMap?.get(String(item?.id?.videoId || '').trim()), now))
      .filter((item) => item.videoId)
      .filter((item) => trackMatchesMusicLanguage(item, resolvedLanguage))
    ).slice(0, 8);

    const responsePayload = { language: resolvedLanguage, results: stampTracksLanguage(results, resolvedLanguage) };
    await writeCachedQuery(cacheKey, responsePayload, now);
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (error) {
    const fallbackResults = await fetchFallbackSearchResults(q, now, resolvedLanguage, regionCode).catch(() => []);
    if (fallbackResults.length) {
      const responsePayload = { language: resolvedLanguage, results: stampTracksLanguage(fallbackResults, resolvedLanguage) };
      await writeCachedQuery(cacheKey, responsePayload, now);
      res.setHeader('X-Cache', 'MISS-FALLBACK');
      return res.status(200).json(responsePayload);
    }
    return res.status(500).json({ error: 'server_error' });
  }
};
