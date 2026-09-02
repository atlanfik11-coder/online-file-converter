const SUPPORTED_MUSIC_LANGS = new Set([
  'tr', 'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'ru', 'ar', 'hi', 'ja', 'ko', 'zh'
]);

const MUSIC_REGION_MAP = {
  tr: 'TR',
  en: 'US',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  it: 'IT',
  pt: 'BR',
  nl: 'NL',
  sv: 'SE',
  ru: 'RU',
  ar: 'SA',
  hi: 'IN',
  ja: 'JP',
  ko: 'KR',
  zh: 'CN'
};

const MUSIC_WEB_LOCALE_MAP = {
  tr: 'tr-TR,tr;q=0.9,en;q=0.7',
  en: 'en-US,en;q=0.9',
  de: 'de-DE,de;q=0.9,en;q=0.7',
  fr: 'fr-FR,fr;q=0.9,en;q=0.7',
  es: 'es-ES,es;q=0.9,en;q=0.7',
  it: 'it-IT,it;q=0.9,en;q=0.7',
  pt: 'pt-BR,pt;q=0.9,en;q=0.7',
  nl: 'nl-NL,nl;q=0.9,en;q=0.7',
  sv: 'sv-SE,sv;q=0.9,en;q=0.7',
  ru: 'ru-RU,ru;q=0.9,en;q=0.7',
  ar: 'ar-SA,ar;q=0.9,en;q=0.7',
  hi: 'hi-IN,hi;q=0.9,en;q=0.7',
  ja: 'ja-JP,ja;q=0.9,en;q=0.7',
  ko: 'ko-KR,ko;q=0.9,en;q=0.7',
  zh: 'zh-CN,zh;q=0.9,en;q=0.7'
};

const SCRIPT_PATTERNS = {
  ru: /[\u0400-\u04FF]/,
  ar: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/,
  hi: /[\u0900-\u097F]/,
  jaKana: /[\u3040-\u30FF]/,
  ko: /[\uAC00-\uD7AF\u1100-\u11FF]/,
  zhHan: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/
};

function normalizeMusicLanguage(value, fallback = 'en') {
  const raw = String(value || '').trim().toLowerCase();
  const short = raw.slice(0, 2);
  if (SUPPORTED_MUSIC_LANGS.has(short)) return short;
  const fallbackShort = String(fallback || '').trim().toLowerCase().slice(0, 2);
  if (SUPPORTED_MUSIC_LANGS.has(fallbackShort)) return fallbackShort;
  return 'en';
}

function detectMusicLanguageFromText(value = '', fallback = '') {
  const input = String(value || '');
  if (!input.trim()) return normalizeMusicLanguage(fallback || 'en');
  if (SCRIPT_PATTERNS.ko.test(input)) return 'ko';
  if (SCRIPT_PATTERNS.jaKana.test(input)) return 'ja';
  if (SCRIPT_PATTERNS.ru.test(input)) return 'ru';
  if (SCRIPT_PATTERNS.ar.test(input)) return 'ar';
  if (SCRIPT_PATTERNS.hi.test(input)) return 'hi';
  if (SCRIPT_PATTERNS.zhHan.test(input)) return 'zh';
  if (/[ığüşöçİ]/i.test(input)) return 'tr';
  if (/[äöüß]/i.test(input)) return 'de';
  if (/[àâæçéèêëîïôœùûüÿ]/i.test(input)) return 'fr';
  if (/[ñáéíóú¡¿]/i.test(input)) return 'es';
  if (/[ãõ]/i.test(input)) return 'pt';
  if (/[å]/i.test(input)) return 'sv';
  return normalizeMusicLanguage(fallback || 'en');
}

function resolveMusicLanguage({ requestedLang = '', text = '', fallback = 'tr' } = {}) {
  const requested = String(requestedLang || '').trim().toLowerCase().slice(0, 2);
  if (SUPPORTED_MUSIC_LANGS.has(requested)) return requested;
  return detectMusicLanguageFromText(text, fallback);
}

function getMusicRegionCode(lang = 'en') {
  return MUSIC_REGION_MAP[normalizeMusicLanguage(lang)] || 'US';
}

function getMusicAcceptLanguage(lang = 'en') {
  return MUSIC_WEB_LOCALE_MAP[normalizeMusicLanguage(lang)] || MUSIC_WEB_LOCALE_MAP.en;
}

function trackMatchesMusicLanguage(track = {}, lang = 'en') {
  const target = normalizeMusicLanguage(lang);
  const text = `${track?.title || ''} ${track?.channel || ''}`.trim();
  if (!text) return true;
  const hasRu = SCRIPT_PATTERNS.ru.test(text);
  const hasAr = SCRIPT_PATTERNS.ar.test(text);
  const hasHi = SCRIPT_PATTERNS.hi.test(text);
  const hasKana = SCRIPT_PATTERNS.jaKana.test(text);
  const hasKo = SCRIPT_PATTERNS.ko.test(text);
  const hasHan = SCRIPT_PATTERNS.zhHan.test(text);

  if (target === 'ru') return hasRu;
  if (target === 'ar') return hasAr;
  if (target === 'hi') return hasHi;
  if (target === 'ko') return hasKo;
  if (target === 'ja') return hasKana || (/[\u3000-\u303F]/.test(text) && hasHan && !hasKo);
  if (target === 'zh') return hasHan && !hasKana && !hasKo;
  if (hasRu || hasAr || hasHi || hasKana || hasKo) return false;
  return true;
}

function stampTracksLanguage(items = [], lang = 'en') {
  const normalizedLang = normalizeMusicLanguage(lang);
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    lang: normalizeMusicLanguage(item?.lang || normalizedLang)
  }));
}

module.exports = {
  SUPPORTED_MUSIC_LANGS,
  normalizeMusicLanguage,
  detectMusicLanguageFromText,
  resolveMusicLanguage,
  getMusicRegionCode,
  getMusicAcceptLanguage,
  trackMatchesMusicLanguage,
  stampTracksLanguage
};
