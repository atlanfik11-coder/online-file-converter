const crypto = require('crypto');
const { isRedisConfigured, redisEval, redisGet, redisSetJson } = require('./_lib/redis-store');
const {
  cleanTrackTitle,
  buildTitleKey,
  buildArtistKey,
  buildSongKey,
  buildCompactSearchKey,
  computeTokenOverlap,
  isSameSongFamily,
  fetchVideoDetails,
  shouldKeepMusicCandidate,
  normalizeMusicTrack
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
const LANGUAGE_FALLBACK_MAP = {
  tr: {
    general: ['turkce sarki', 'turkce pop sarki', 'turkce slow sarki', 'turkce akustik sarki', 'turkce indie sarki'],
    moods: {
      slow: ['turkce duygusal sarki', 'turkce slow sarki', 'turkce sakin muzik'],
      folk: ['saz muzigi', 'baglama muzigi', 'turkce halk muzigi', 'turku'],
      dance: ['turkce hareketli sarki', 'turkce pop hit', 'turkce dans muzigi'],
      rap: ['turkce rap', 'turkce hip hop'],
      rock: ['turkce rock', 'anadolu rock'],
      instrumental: ['enstrumantal turkce muzik', 'saz enstrumantal']
    }
  },
  en: {
    general: ['english song', 'english pop song', 'english chill song', 'english acoustic song', 'english indie song'],
    moods: {
      slow: ['english slow song', 'english emotional song', 'english calm music'],
      folk: ['english folk song', 'acoustic folk song'],
      dance: ['english dance song', 'english pop hit', 'english upbeat song'],
      rap: ['english rap song', 'english hip hop'],
      rock: ['english rock song', 'classic rock song'],
      instrumental: ['instrumental english music', 'piano instrumental']
    }
  },
  ru: {
    general: ['русская музыка', 'русская поп музыка', 'русская медленная музыка', 'русская акустика'],
    moods: {
      slow: ['русская лирическая песня', 'русская спокойная музыка'],
      dance: ['русская танцевальная музыка', 'русские хиты'],
      rap: ['русский рэп'],
      rock: ['русский рок']
    }
  },
  ar: {
    general: ['اغاني عربية', 'موسيقى عربية هادئة', 'بوب عربي', 'اغاني عربية رومانسية'],
    moods: {
      slow: ['اغاني عربية هادئة', 'موسيقى عربية رومانسية'],
      dance: ['اغاني عربية حماسية', 'بوب عربي'],
      instrumental: ['موسيقى عربية بدون كلمات']
    }
  },
  hi: {
    general: ['हिंदी गाने', 'हिंदी पॉप सॉन्ग', 'हिंदी सॉफ्ट सॉन्ग', 'हिंदी रोमांटिक सॉन्ग'],
    moods: {
      slow: ['हिंदी सॉफ्ट सॉन्ग', 'हिंदी रोमांटिक सॉन्ग'],
      dance: ['हिंदी डांस सॉन्ग', 'हिंदी पार्टी सॉन्ग'],
      rap: ['हिंदी रैप'],
      rock: ['हिंदी रॉक']
    }
  },
  ja: {
    general: ['日本の曲', 'JPOP', '日本のバラード', '日本のインディー'],
    moods: {
      slow: ['日本のバラード', '落ち着いた日本の曲'],
      dance: ['JPOP ヒット', '日本のダンス曲'],
      rock: ['日本のロック']
    }
  },
  ko: {
    general: ['한국 노래', 'KPOP', '한국 발라드', '한국 인디 음악'],
    moods: {
      slow: ['한국 발라드', '잔잔한 한국 음악'],
      dance: ['KPOP 히트곡', '한국 댄스 음악'],
      rap: ['한국 힙합'],
      rock: ['한국 록']
    }
  },
  zh: {
    general: ['中文歌曲', '华语流行', '中文慢歌', '中文独立音乐'],
    moods: {
      slow: ['中文慢歌', '中文抒情歌'],
      dance: ['华语流行热歌', '中文舞曲'],
      rock: ['中文摇滚']
    }
  },
  de: { general: ['deutsche musik', 'deutscher pop', 'deutsche ballade', 'deutsche akustik'], moods: { slow: ['deutsche ballade', 'ruhige deutsche musik'], dance: ['deutscher pop hit'], rock: ['deutscher rock'] } },
  fr: { general: ['chanson francaise', 'pop francaise', 'ballade francaise', 'musique francaise calme'], moods: { slow: ['ballade francaise', 'musique francaise calme'], dance: ['pop francaise hit'], rock: ['rock francais'] } },
  es: { general: ['cancion en espanol', 'pop en espanol', 'balada en espanol', 'musica latina suave'], moods: { slow: ['balada en espanol', 'musica latina suave'], dance: ['pop latino', 'musica latina bailable'], rock: ['rock en espanol'] } },
  it: { general: ['canzone italiana', 'pop italiano', 'ballata italiana', 'musica italiana calma'], moods: { slow: ['ballata italiana', 'musica italiana calma'], dance: ['pop italiano hit'], rock: ['rock italiano'] } },
  pt: { general: ['musica portuguesa', 'pop portugues', 'musica lenta portuguesa', 'musica brasileira calma'], moods: { slow: ['musica lenta portuguesa', 'musica brasileira calma'], dance: ['pop brasileiro', 'musica dançante portuguesa'], rock: ['rock portugues'] } },
  nl: { general: ['nederlandse muziek', 'nederlandse pop', 'nederlandse rustige muziek'], moods: { slow: ['nederlandse rustige muziek'], dance: ['nederlandse pop hit'] } },
  sv: { general: ['svensk musik', 'svensk pop', 'svensk lugn musik'], moods: { slow: ['svensk lugn musik'], dance: ['svensk pop hit'] } }
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 12;
const QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTOPLAY_CACHE_VERSION = 'v5';
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
  if (!isRedisConfigured()) return takeRateLimitTokenMemory(ip, now);
  const windowSeconds = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
  const key = `opket:music:auto:rl:${crypto.createHash('sha1').update(ip).digest('hex')}`;
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
  if (!isRedisConfigured()) return readCachedQueryMemory(query, now);
  const key = `opket:music:auto:cache:${crypto.createHash('sha1').update(query).digest('hex')}`;
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
  const key = `opket:music:auto:cache:${crypto.createHash('sha1').update(query).digest('hex')}`;
  try {
    await redisSetJson(key, payload, Math.ceil(QUERY_CACHE_TTL_MS / 1000));
  } catch (error) {
    writeCachedQueryMemory(query, payload, now);
  }
}

function buildFallbackQueries(title, channel) {
  const cleanTitle = cleanTrackTitle(title).slice(0, 120);
  const cleanChannel = String(channel || '').trim().slice(0, 120);
  const keywordQuery = buildSongKey(cleanTitle, cleanChannel).split(' ').slice(0, 4).join(' ');
  const queries = [
    cleanTitle,
    keywordQuery ? `${keywordQuery} music` : '',
    keywordQuery ? `${keywordQuery} song` : '',
    [keywordQuery, 'playlist'].filter(Boolean).join(' ').trim()
  ];
  return Array.from(new Set(queries.filter(Boolean)));
}

function inferAutoplayMood(title, channel) {
  const combined = `${title || ''} ${channel || ''}`.toLowerCase();
  if (/\b(slow|calm|soft|sad|emotional|ballad|acoustic|piano|romantic|lofi|chill|sakin|yavas|duygusal|huzun)\b/i.test(combined)) return 'slow';
  if (/\b(saz|baglama|folk|turku|arabesk|oud|ney|keman|violin)\b/i.test(combined)) return 'folk';
  if (/\b(dance|club|party|edm|upbeat|hit|hareketli)\b/i.test(combined)) return 'dance';
  if (/\b(rap|hip hop|hiphop|trap)\b/i.test(combined)) return 'rap';
  if (/\b(rock|metal|punk)\b/i.test(combined)) return 'rock';
  if (/\b(instrumental|orchestral|soundtrack|ambient)\b/i.test(combined)) return 'instrumental';
  return '';
}

function buildLanguageFallbackQueries(lang, title, channel) {
  const profile = LANGUAGE_FALLBACK_MAP[lang] || LANGUAGE_FALLBACK_MAP.en;
  const mood = inferAutoplayMood(title, channel);
  const moodQueries = mood ? (profile.moods?.[mood] || []) : [];
  return Array.from(new Set([...(moodQueries || []), ...(profile.general || [])].filter(Boolean)));
}

async function youtubeFetch(apiKey, params) {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'youtube_search_failed');
    error.status = response.status;
    throw error;
  }
  return Array.isArray(payload.items) ? payload.items : [];
}

function dedupeResults(items, detailsMap, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, now, language) {
  const seenVideoIds = new Set();
  const seenTitleKeys = new Set();
  const seenSongKeys = new Set();
  return items
    .filter((item) => looksMusicSafe(item))
    .filter((item) => shouldKeepMusicCandidate(item, detailsMap?.get(String(item?.id?.videoId || '').trim()), {
      seedVideoId,
      seedTitleKey,
      seedSongKey,
      seedArtistKey,
      requireMusicCategory: true
    }))
    .map((item) => normalizeMusicTrack(item, detailsMap?.get(String(item?.id?.videoId || '').trim()), now))
    .filter((item) => item.videoId)
    .filter((item) => trackMatchesMusicLanguage(item, language))
    .filter((item) => {
      if (seenVideoIds.has(item.videoId)) return false;
      if (item.titleKey && seenTitleKeys.has(item.titleKey)) return false;
      if (item.songKey && seenSongKeys.has(item.songKey)) return false;
      seenVideoIds.add(item.videoId);
      if (item.titleKey) seenTitleKeys.add(item.titleKey);
      if (item.songKey) seenSongKeys.add(item.songKey);
      return true;
    });
}

function mergeUniqueTracks(...lists) {
  const merged = [];
  const seenVideoIds = new Set();
  const seenTitleKeys = new Set();
  const seenSongKeys = new Set();
  lists.flat().forEach((item) => {
    if (!item?.videoId) return;
    if (seenVideoIds.has(item.videoId)) return;
    if (item.titleKey && seenTitleKeys.has(item.titleKey)) return;
    if (item.songKey && seenSongKeys.has(item.songKey)) return;
    seenVideoIds.add(item.videoId);
    if (item.titleKey) seenTitleKeys.add(item.titleKey);
    if (item.songKey) seenSongKeys.add(item.songKey);
    merged.push(item);
  });
  return merged;
}

async function fetchRelatedResults(apiKey, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, regionCode, relevanceLanguage, now) {
  if (!seedVideoId) return [];
  const params = new URLSearchParams({
    part: 'snippet',
    maxResults: '18',
    relatedToVideoId: seedVideoId,
    type: 'video',
    videoEmbeddable: 'true',
    safeSearch: 'strict',
    regionCode,
    relevanceLanguage,
    key: apiKey
  });
  try {
    const items = await youtubeFetch(apiKey, params);
    const detailsMap = await fetchVideoDetails(apiKey, items.map((item) => item?.id?.videoId));
    return dedupeResults(items, detailsMap, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, now, relevanceLanguage);
  } catch (error) {
    return [];
  }
}

async function fetchFallbackResults(apiKey, queries, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, regionCode, relevanceLanguage, now) {
  const collected = [];
  for (const query of queries) {
    const params = new URLSearchParams({
      part: 'snippet',
      maxResults: '10',
      q: query,
      type: 'video',
      videoEmbeddable: 'true',
      videoCategoryId: '10',
      safeSearch: 'strict',
      regionCode,
      relevanceLanguage,
      key: apiKey
    });
    try {
      const items = await youtubeFetch(apiKey, params);
      const detailsMap = await fetchVideoDetails(apiKey, items.map((item) => item?.id?.videoId));
      collected.push(...dedupeResults(items, detailsMap, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, now, relevanceLanguage));
      if (collected.length >= 12) break;
    } catch (error) {
      continue;
    }
  }
  return mergeUniqueTracks(collected);
}

async function fetchWebFallbackResults(queries, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, language, regionCode, now) {
  const collected = [];
  const compactSeedTitle = buildCompactSearchKey(seedTitleKey);
  const compactSeedSong = buildCompactSearchKey(seedSongKey);
  const compactSeedArtist = buildCompactSearchKey(seedArtistKey);
  for (const query of queries) {
    try {
      const items = await fetchYouTubeWebResults(query, { limit: 8, lang: language, region: regionCode });
      collected.push(...items
        .filter((item) => item?.videoId && item.videoId !== seedVideoId)
        .filter((item) => !item?.titleKey || item.titleKey !== seedTitleKey)
        .filter((item) => !item?.songKey || item.songKey !== seedSongKey)
        .filter((item) => !item?.artistKey || item.artistKey !== seedArtistKey)
        .filter((item) => computeTokenOverlap(item?.titleKey || '', seedTitleKey) < 0.75)
        .filter((item) => computeTokenOverlap(item?.songKey || '', seedSongKey) < 0.75)
        .filter((item) => computeTokenOverlap(item?.artistKey || '', seedArtistKey) < 0.5)
        .filter((item) => computeTokenOverlap(item?.titleKey || '', seedArtistKey) < 0.5)
        .filter((item) => !isSameSongFamily(seedTitleKey, item?.titleKey || ''))
        .filter((item) => !isSameSongFamily(seedSongKey, item?.songKey || ''))
        .filter((item) => {
          const compactTitle = buildCompactSearchKey(item?.title || '');
          const compactChannel = buildCompactSearchKey(item?.channel || '');
          if (compactSeedTitle && compactSeedTitle.length > 4 && compactTitle.includes(compactSeedTitle)) return false;
          if (compactSeedSong && compactSeedSong.length > 4 && compactTitle.includes(compactSeedSong)) return false;
          if (compactSeedArtist && compactSeedArtist.length > 3 && (compactTitle.includes(compactSeedArtist) || compactChannel.includes(compactSeedArtist))) return false;
          return true;
        })
        .filter((item) => !containsBlockedTerm(`${item?.title || ''} ${item?.channel || ''}`))
        .filter((item) => trackMatchesMusicLanguage(item, language))
        .map((item) => ({ ...item, addedAt: now })));
      if (collected.length >= 12) break;
    } catch (error) {
      continue;
    }
  }
  return mergeUniqueTracks(collected);
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

  const seedVideoId = typeof req.query?.videoId === 'string' ? req.query.videoId.trim().slice(0, 32) : '';
  const title = typeof req.query?.title === 'string' ? req.query.title.trim().slice(0, 120) : '';
  const channel = typeof req.query?.channel === 'string' ? req.query.channel.trim().slice(0, 120) : '';
  const requestedLang = typeof req.query?.lang === 'string' ? req.query.lang.trim().slice(0, 8).toLowerCase() : '';

  if (!seedVideoId && !title) {
    return res.status(400).json({ error: 'missing_seed' });
  }
  if (containsBlockedTerm(`${title} ${channel}`)) {
    return res.status(400).json({ error: 'query_blocked' });
  }

  const relevanceLanguage = resolveMusicLanguage({
    requestedLang,
    text: `${title} ${channel}`.trim(),
    fallback: 'tr'
  });
  const regionCode = getMusicRegionCode(relevanceLanguage);
  const seedTitleKey = buildTitleKey(title);
  const seedSongKey = buildSongKey(title, channel);
  const seedArtistKey = buildArtistKey(channel);
  const fallbackQueries = buildFallbackQueries(title, channel);
  const languageFallbackQueries = buildLanguageFallbackQueries(relevanceLanguage, title, channel);
  const cacheKey = `${AUTOPLAY_CACHE_VERSION}|${seedVideoId}|${title}|${channel}|${relevanceLanguage}`.toLowerCase();
  const cached = await readCachedQuery(cacheKey, now);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached);
  }

  let results = [];
  if (apiKey) {
    const related = await fetchRelatedResults(apiKey, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, regionCode, relevanceLanguage, now);
    results = related;
    if (results.length < 8 && languageFallbackQueries.length) {
      const languageFallback = await fetchFallbackResults(apiKey, languageFallbackQueries, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, regionCode, relevanceLanguage, now);
      results = mergeUniqueTracks(results, languageFallback);
    }
    if (results.length < 8) {
      const fallback = await fetchFallbackResults(apiKey, fallbackQueries, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, regionCode, relevanceLanguage, now);
      results = mergeUniqueTracks(results, fallback);
    }
  }
  if (results.length < 8 && languageFallbackQueries.length) {
    const webLanguageFallback = await fetchWebFallbackResults(languageFallbackQueries, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, relevanceLanguage, regionCode, now);
    results = mergeUniqueTracks(results, webLanguageFallback);
  }
  if (results.length < 8) {
    const webFallback = await fetchWebFallbackResults(fallbackQueries, seedVideoId, seedTitleKey, seedSongKey, seedArtistKey, relevanceLanguage, regionCode, now);
    results = mergeUniqueTracks(results, webFallback);
  }

  const responsePayload = { language: relevanceLanguage, results: stampTracksLanguage(results.slice(0, 8), relevanceLanguage) };
  await writeCachedQuery(cacheKey, responsePayload, now);
  res.setHeader('X-Cache', 'MISS');
  return res.status(200).json(responsePayload);
};
