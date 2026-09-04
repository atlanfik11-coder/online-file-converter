const {
  buildTitleKey,
  buildArtistKey,
  buildSongKey,
  looksLikeUnwantedMusicVariant,
  looksLikeGarbageMusicTitle,
  looksLikeShortsText,
  parseIsoDurationSeconds,
  DEFAULT_MIN_DURATION_SEC,
  DEFAULT_MAX_DURATION_SEC
} = require('./youtube-music-filter');
const {
  normalizeMusicLanguage,
  getMusicAcceptLanguage,
  getMusicRegionCode
} = require('./music-language');

function extractJsonByMarker(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const braceStart = html.indexOf('{', start + marker.length);
  if (braceStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return html.slice(braceStart, i + 1);
      }
    }
  }
  return null;
}

function parseYtInitialData(html) {
  const markers = [
    'var ytInitialData = ',
    'window["ytInitialData"] = ',
    'ytInitialData = '
  ];
  for (const marker of markers) {
    const jsonText = extractJsonByMarker(html, marker);
    if (!jsonText) continue;
    try {
      return JSON.parse(jsonText);
    } catch (error) {
      continue;
    }
  }
  return null;
}

function collectVideoRenderers(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((item) => collectVideoRenderers(item, out));
    return out;
  }
  if (node.videoRenderer) out.push(node.videoRenderer);
  Object.values(node).forEach((value) => collectVideoRenderers(value, out));
  return out;
}

function extractVideoIdsFromHtml(html, limit = 16) {
  const ids = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)) {
    const id = String(match[1] || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function readText(value) {
  if (!value) return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run) => run?.text || '').join('').trim();
  return '';
}

function parseClockToSeconds(value = '') {
  const parts = String(value || '').trim().split(':').map((part) => parseInt(part, 10) || 0);
  if (!parts.length || parts.length > 3) return 0;
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  return parts[0];
}

function getRendererDurationSec(renderer) {
  const direct = parseClockToSeconds(readText(renderer?.lengthText));
  if (direct > 0) return direct;
  const overlay = Array.isArray(renderer?.thumbnailOverlays)
    ? renderer.thumbnailOverlays.find((item) => item?.thumbnailOverlayTimeStatusRenderer)
    : null;
  const overlayText = readText(overlay?.thumbnailOverlayTimeStatusRenderer?.text);
  return parseClockToSeconds(overlayText);
}

async function fetchOEmbedTrack(videoId, {
  lang = 'en',
  acceptLanguage = getMusicAcceptLanguage(lang)
} = {}) {
  const normalizedLang = normalizeMusicLanguage(lang, 'en');
  const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36',
      'Accept-Language': acceptLanguage
    }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload?.title) return null;
  const title = String(payload.title || '').trim();
  const channel = String(payload.author_name || '').trim();
  const titleKey = buildTitleKey(title);
  if (!titleKey) return null;
  if (looksLikeShortsText(title, channel)) return null;
  if (looksLikeUnwantedMusicVariant(title, channel)) return null;
  if (looksLikeGarbageMusicTitle(title)) return null;
  return {
    id: `result-${videoId}`,
    videoId,
    title,
    channel,
    thumb: String(payload.thumbnail_url || '').trim(),
    titleKey,
    artistKey: buildArtistKey(channel),
    songKey: buildSongKey(title, channel),
    lang: normalizedLang,
    durationSec: 0,
    addedAt: Date.now()
  };
}

async function fetchYouTubeWebResults(query, {
  limit = 8,
  lang = 'en',
  region = '',
  minDurationSec = DEFAULT_MIN_DURATION_SEC,
  maxDurationSec = DEFAULT_MAX_DURATION_SEC
} = {}) {
  const normalizedLang = normalizeMusicLanguage(lang, 'en');
  const normalizedRegion = String(region || '').trim().toUpperCase() || getMusicRegionCode(normalizedLang);
  const acceptLanguage = getMusicAcceptLanguage(normalizedLang);
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(String(query || '').trim())}&hl=${encodeURIComponent(normalizedLang)}&persist_hl=1&gl=${encodeURIComponent(normalizedRegion)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36',
      'Accept-Language': acceptLanguage
    }
  });
  if (!response.ok) {
    const error = new Error(`youtube_web_search_failed_${response.status}`);
    error.status = response.status;
    throw error;
  }
  const html = await response.text();
  const data = parseYtInitialData(html);
  if (!data) return [];
  const renderers = collectVideoRenderers(data, []);
  const seenVideoIds = new Set();
  const seenTitleKeys = new Set();
  const now = Date.now();
  const results = [];
  for (const renderer of renderers) {
    const videoId = String(renderer?.videoId || '').trim();
    if (!videoId || seenVideoIds.has(videoId)) continue;
    const title = readText(renderer?.title);
    const channel = readText(renderer?.ownerText) || readText(renderer?.longBylineText) || readText(renderer?.shortBylineText);
    const durationText = readText(renderer?.lengthText);
    const durationSec = getRendererDurationSec(renderer);
    const titleKey = buildTitleKey(title);
    if (!title || !titleKey) continue;
    if (looksLikeShortsText(title, channel, durationText)) continue;
    if (looksLikeUnwantedMusicVariant(title, channel, durationText)) continue;
    if (looksLikeGarbageMusicTitle(title)) continue;
    if (durationSec > 0 && durationSec < minDurationSec) continue;
    if (durationSec > maxDurationSec) continue;
    if (seenTitleKeys.has(titleKey)) continue;
    const thumb =
      renderer?.thumbnail?.thumbnails?.[renderer.thumbnail.thumbnails.length - 1]?.url ||
      renderer?.thumbnail?.thumbnails?.[0]?.url ||
      '';
    seenVideoIds.add(videoId);
    seenTitleKeys.add(titleKey);
    results.push({
      id: `result-${videoId}`,
      videoId,
      title,
      channel,
      thumb,
      titleKey,
      artistKey: buildArtistKey(channel),
      songKey: buildSongKey(title, channel),
      lang: normalizedLang,
      durationSec: durationSec || parseIsoDurationSeconds(''),
      addedAt: now
    });
    if (results.length >= limit) break;
  }
  if (results.length >= limit) return results;

  const fallbackIds = extractVideoIdsFromHtml(html, Math.max(limit * 3, 16));
  for (const videoId of fallbackIds) {
    if (seenVideoIds.has(videoId)) continue;
    try {
      const item = await fetchOEmbedTrack(videoId, {
        lang: normalizedLang,
        acceptLanguage
      });
      if (!item) continue;
      if (seenTitleKeys.has(item.titleKey)) continue;
      seenVideoIds.add(videoId);
      seenTitleKeys.add(item.titleKey);
      results.push(item);
      if (results.length >= limit) break;
    } catch (error) {
      continue;
    }
  }
  return results;
}

module.exports = {
  fetchYouTubeWebResults
};
