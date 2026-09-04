const SHORTS_PATTERNS = [
  /#shorts\b/i,
  /\byoutube shorts\b/i,
  /\bshorts\b/i,
  /\bshort video\b/i,
  /\bshort clip\b/i,
  /\breels?\b/i,
  /\btiktok\b/i
];
const UNWANTED_MUSIC_VARIANT_PATTERNS = [
  /\bplaylist\b/i,
  /\bfull album\b/i,
  /\bgreatest hits\b/i,
  /\bcompilation\b/i,
  /\bkaraoke\b/i,
  /\binstrumental\b/i,
  /\bcover\b/i,
  /\btribute\b/i,
  /\bremix\b/i,
  /\bremake\b/i,
  /\bmashup\b/i,
  /\bmedley\b/i,
  /\bslowed\b/i,
  /\breverb\b/i,
  /\bsped up\b/i,
  /\bnightcore\b/i,
  /\b8d\b/i,
  /\brickroll(?:ed)?\b/i,
  /\brick roll\b/i,
  /\bmeme\b/i,
  /\bprank\b/i,
  /\banimated short\b/i
];

const MUSIC_CATEGORY_ID = '10';
const DEFAULT_MIN_DURATION_SEC = 61;
const DEFAULT_MAX_DURATION_SEC = 900;
const MUSIC_NOISE_WORDS = new Set([
  'feat', 'ft', 'featuring', 'official', 'audio', 'video', 'lyrics', 'lyric', 'visualizer',
  'remaster', 'remastered', 'live', 'mix', 'version', 'edit', 'radio', 'cover', 'topic',
  'vevo', 'records', 'recordings', 'music', 'channel', 'hq', 'hd', '4k'
]);

function cleanTrackTitle(value = '') {
  return String(value || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]+\)/g, ' ')
    .replace(/\b(official|lyrics?|audio|video|clip|visualizer|remaster(?:ed)?|remastered?|hd|4k|live)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(feat|ft|featuring|official|topic|vevo|records?|recordings?|music|channel)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCompactSearchKey(value = '') {
  return normalizeSearchKey(value).replace(/\s+/g, '');
}

function buildTitleKey(value = '') {
  return normalizeSearchKey(cleanTrackTitle(value))
    .split(/\s+/)
    .filter((token) => token && token.length > 1)
    .slice(0, 8)
    .join(' ');
}

function buildArtistKey(value = '') {
  return normalizeSearchKey(value);
}

function tokenizeMusicIdentity(value = '') {
  return normalizeSearchKey(cleanTrackTitle(value))
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token.length > 1 && !MUSIC_NOISE_WORDS.has(token));
}

function buildSongKey(title = '', channel = '') {
  const titleTokens = tokenizeMusicIdentity(title);
  const artistTokens = new Set(tokenizeMusicIdentity(channel));
  const filteredTitleTokens = titleTokens.filter((token) => !artistTokens.has(token));
  const effectiveTokens = filteredTitleTokens.length ? filteredTitleTokens : titleTokens;
  return effectiveTokens.slice(0, 6).join(' ');
}

function computeTokenOverlap(a = '', b = '') {
  const setA = new Set(tokenizeMusicIdentity(a));
  const setB = new Set(tokenizeMusicIdentity(b));
  if (!setA.size || !setB.size) return 0;
  let common = 0;
  setA.forEach((token) => {
    if (setB.has(token)) common += 1;
  });
  return common / Math.max(setA.size, setB.size);
}

function countTokenOverlap(a = '', b = '') {
  const setA = new Set(tokenizeMusicIdentity(a));
  const setB = new Set(tokenizeMusicIdentity(b));
  if (!setA.size || !setB.size) return 0;
  let common = 0;
  setA.forEach((token) => {
    if (setB.has(token)) common += 1;
  });
  return common;
}

function looksLikeUnwantedMusicVariant(...parts) {
  const combined = parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  if (!combined) return false;
  return UNWANTED_MUSIC_VARIANT_PATTERNS.some((pattern) => pattern.test(combined));
}

function looksLikeGarbageMusicTitle(value = '') {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return true;
  const compact = input.replace(/\s+/g, '');
  if (compact.length >= 8 && /^([a-z0-9])\1{6,}$/i.test(compact)) return true;
  const uniqueChars = new Set(compact.split('')).size;
  if (compact.length >= 10 && uniqueChars <= 2) return true;
  return false;
}

function isSameSongFamily(seedTitle = '', candidateTitle = '') {
  const overlap = countTokenOverlap(seedTitle, candidateTitle);
  const seedTokens = tokenizeMusicIdentity(seedTitle);
  if (!seedTokens.length) return false;
  if (overlap >= Math.min(3, seedTokens.length)) return true;
  return (overlap / seedTokens.length) >= 0.5;
}

function looksLikeShortsText(...parts) {
  const combined = parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  if (!combined) return false;
  return SHORTS_PATTERNS.some((pattern) => pattern.test(combined));
}

function parseIsoDurationSeconds(value = '') {
  const input = String(value || '');
  const match = input.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10) || 0;
  const minutes = parseInt(match[2] || '0', 10) || 0;
  const seconds = parseInt(match[3] || '0', 10) || 0;
  return (hours * 3600) + (minutes * 60) + seconds;
}

async function fetchVideoDetails(apiKey, ids = []) {
  const cleanIds = Array.from(new Set(
    ids
      .map((id) => String(id || '').trim())
      .filter(Boolean)
      .slice(0, 50)
  ));
  if (!apiKey || !cleanIds.length) return null;
  const params = new URLSearchParams({
    part: 'contentDetails,snippet',
    id: cleanIds.join(','),
    maxResults: String(cleanIds.length),
    key: apiKey
  });
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) return null;
    const map = new Map();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    items.forEach((item) => {
      const videoId = String(item?.id || '').trim();
      if (!videoId) return;
      const title = item?.snippet?.title || '';
      const channel = item?.snippet?.channelTitle || '';
      map.set(videoId, {
        videoId,
        title,
        channel,
        categoryId: String(item?.snippet?.categoryId || '').trim(),
        durationSec: parseIsoDurationSeconds(item?.contentDetails?.duration || ''),
        titleKey: buildTitleKey(title),
        artistKey: buildArtistKey(channel),
        songKey: buildSongKey(title, channel)
      });
    });
    return map;
  } catch (error) {
    return null;
  }
}

function shouldKeepMusicCandidate(item, detail, {
  seedVideoId = '',
  seedTitleKey = '',
  seedSongKey = '',
  seedArtistKey = '',
  minDurationSec = DEFAULT_MIN_DURATION_SEC,
  maxDurationSec = DEFAULT_MAX_DURATION_SEC,
  requireMusicCategory = false
} = {}) {
  const videoId = String(item?.id?.videoId || item?.videoId || '').trim();
  if (!videoId) return false;
  if (seedVideoId && videoId === seedVideoId) return false;

  const title = item?.snippet?.title || item?.title || '';
  const channel = item?.snippet?.channelTitle || item?.channel || '';
  if (looksLikeShortsText(title, channel)) return false;
  if (looksLikeUnwantedMusicVariant(title, channel)) return false;
  if (looksLikeGarbageMusicTitle(title)) return false;

  const titleKey = detail?.titleKey || buildTitleKey(title);
  const songKey = detail?.songKey || buildSongKey(title, channel);
  const artistKey = detail?.artistKey || buildArtistKey(channel);
  const compactTitle = buildCompactSearchKey(title);
  const compactChannel = buildCompactSearchKey(channel);
  const compactSeedTitle = buildCompactSearchKey(seedTitleKey);
  const compactSeedSong = buildCompactSearchKey(seedSongKey);
  const compactSeedArtist = buildCompactSearchKey(seedArtistKey);
  if (seedTitleKey && titleKey && titleKey === seedTitleKey) return false;
  if (seedSongKey && songKey && songKey === seedSongKey) return false;
  if (seedArtistKey && artistKey && artistKey === seedArtistKey) return false;
  if (compactSeedTitle && compactSeedTitle.length > 4 && compactTitle.includes(compactSeedTitle)) return false;
  if (compactSeedSong && compactSeedSong.length > 4 && compactTitle.includes(compactSeedSong)) return false;
  if (compactSeedArtist && compactSeedArtist.length > 3 && (compactTitle.includes(compactSeedArtist) || compactChannel.includes(compactSeedArtist))) return false;
  if (seedTitleKey && computeTokenOverlap(titleKey, seedTitleKey) >= 0.75) return false;
  if (seedSongKey && computeTokenOverlap(songKey, seedSongKey) >= 0.75) return false;
  if (seedArtistKey && computeTokenOverlap(titleKey, seedArtistKey) >= 0.5) return false;
  if (seedArtistKey && computeTokenOverlap(artistKey, seedArtistKey) >= 0.5) return false;
  if (seedTitleKey && isSameSongFamily(seedTitleKey, titleKey)) return false;
  if (seedSongKey && isSameSongFamily(seedSongKey, songKey)) return false;

  if (detail) {
    if (looksLikeShortsText(detail.title, detail.channel)) return false;
    if (looksLikeUnwantedMusicVariant(detail.title, detail.channel)) return false;
    if (looksLikeGarbageMusicTitle(detail.title)) return false;
    if (requireMusicCategory && detail.categoryId && detail.categoryId !== MUSIC_CATEGORY_ID) return false;
    if (Number.isFinite(detail.durationSec) && detail.durationSec > 0 && detail.durationSec < minDurationSec) return false;
    if (Number.isFinite(detail.durationSec) && detail.durationSec > maxDurationSec) return false;
  }

  return true;
}

function normalizeMusicTrack(item, detail, now) {
  const title = detail?.title || item?.snippet?.title || item?.title || 'Untitled';
  const channel = detail?.channel || item?.snippet?.channelTitle || item?.channel || '';
  return {
    id: `result-${item?.id?.videoId || item?.videoId || ''}`,
    videoId: item?.id?.videoId || item?.videoId || '',
    title,
    channel,
    thumb:
      item?.snippet?.thumbnails?.medium?.url ||
      item?.snippet?.thumbnails?.default?.url ||
      item?.thumb ||
      '',
    titleKey: detail?.titleKey || buildTitleKey(title),
    artistKey: detail?.artistKey || buildArtistKey(channel),
    songKey: detail?.songKey || buildSongKey(title, channel),
    addedAt: now
  };
}

function dedupeNormalizedMusicTracks(items = []) {
  const seenVideoIds = new Set();
  const seenTitleKeys = new Set();
  const seenSongKeys = new Set();
  return items.filter((item) => {
    const videoId = String(item?.videoId || '').trim();
    if (!videoId || seenVideoIds.has(videoId)) return false;
    const titleKey = String(item?.titleKey || '').trim();
    const songKey = String(item?.songKey || '').trim();
    if (titleKey && seenTitleKeys.has(titleKey)) return false;
    if (songKey && seenSongKeys.has(songKey)) return false;
    seenVideoIds.add(videoId);
    if (titleKey) seenTitleKeys.add(titleKey);
    if (songKey) seenSongKeys.add(songKey);
    return true;
  });
}

module.exports = {
  DEFAULT_MIN_DURATION_SEC,
  DEFAULT_MAX_DURATION_SEC,
  MUSIC_CATEGORY_ID,
  cleanTrackTitle,
  normalizeSearchKey,
  buildCompactSearchKey,
  buildTitleKey,
  buildArtistKey,
  buildSongKey,
  computeTokenOverlap,
  countTokenOverlap,
  looksLikeUnwantedMusicVariant,
  looksLikeGarbageMusicTitle,
  isSameSongFamily,
  looksLikeShortsText,
  parseIsoDurationSeconds,
  fetchVideoDetails,
  shouldKeepMusicCandidate,
  normalizeMusicTrack,
  dedupeNormalizedMusicTracks
};
