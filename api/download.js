const { URLSearchParams } = require('url');

async function expandUrl(inputUrl) {
  try {
    if (/vt\.tiktok\.com|vm\.tiktok\.com|youtu\.be|pin\.it|t\.co/i.test(inputUrl)) {
      const response = await fetch(inputUrl, {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (response.url && response.url !== inputUrl) return response.url;
    }
  } catch (e) {}
  return inputUrl;
}

function extractYouTubeId(url) {
  const match = url.match(
    /(?:youtube\.com\/(?:shorts\/|watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  return match ? match[1] : null;
}

function detectPlatform(url) {
  if (!url) return "unknown";
  const cleanUrl = url.trim().toLowerCase();
  if (/tiktok\.com|douyin\.com/i.test(cleanUrl)) return "tiktok";
  if (/youtube\.com|youtu\.be/i.test(cleanUrl)) return "youtube";
  if (/instagram\.com/i.test(cleanUrl)) return "instagram";
  if (/twitter\.com|x\.com/i.test(cleanUrl)) return "twitter";
  if (/facebook\.com|fb\.watch/i.test(cleanUrl)) return "facebook";
  if (/pinterest\.com|pin\.it/i.test(cleanUrl)) return "pinterest";
  if (/reddit\.com|redd\.it/i.test(cleanUrl)) return "reddit";
  return "unknown";
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchYouTubeMetadata(ytId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || `YouTube Video (${ytId})`,
        author: data.author_name || "YouTube",
        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      };
    }
  } catch (e) {}
  return {
    title: `YouTube Video (${ytId})`,
    author: "YouTube",
    thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    let { url, videoQuality = "1080", audioFormat = "mp3", isAudioOnly = false } = body;

    if (!url || typeof url !== "string" || !isValidUrl(url)) {
      return res.status(400).json({ status: "error", error: "Lütfen geçerli bir video bağlantı linki girin." });
    }

    let cleanUrl = url.trim();
    cleanUrl = await expandUrl(cleanUrl);

    const ytId = extractYouTubeId(cleanUrl);
    if (ytId) {
      cleanUrl = `https://www.youtube.com/watch?v=${ytId}`;
    }

    const platform = detectPlatform(cleanUrl);

    // 1. TIKTOK ENGINE (TikWM API)
    if (platform === "tiktok") {
      try {
        const formData = new URLSearchParams();
        formData.append("url", cleanUrl);
        formData.append("hd", "1");
        const tikwmRes = await fetch("https://www.tikwm.com/api/", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
          },
          body: formData.toString(),
        });

        if (tikwmRes.ok) {
          const tikData = await tikwmRes.json();
          if (tikData && tikData.code === 0 && tikData.data) {
            const videoUrl = tikData.data.hdplay || tikData.data.play;
            const audioUrl = tikData.data.music;
            const finalDownloadUrl = isAudioOnly ? (audioUrl || videoUrl) : videoUrl;
            const pickerItems = tikData.data.images
              ? tikData.data.images.map((img, idx) => ({
                  type: `Fotoğraf #${idx + 1}`,
                  url: img,
                  thumb: img,
                }))
              : null;

            return res.status(200).json({
              status: "success",
              url: finalDownloadUrl,
              audioUrl: audioUrl,
              picker: pickerItems,
              info: {
                id: tikData.data.id || String(Date.now()),
                url: cleanUrl,
                downloadUrl: finalDownloadUrl,
                title: tikData.data.title || "TikTok Video",
                author: tikData.data.author?.nickname || "@kullanici",
                thumbnail: tikData.data.cover || null,
                duration: tikData.data.duration || 0,
                platform: "tiktok",
                quality: isAudioOnly ? `${audioFormat.toUpperCase()} (Ses)` : "Filigransız HD",
                isAudioOnly: isAudioOnly,
                filename: `tiktok_${tikData.data.id || Date.now()}.${isAudioOnly ? audioFormat : "mp4"}`,
                timestamp: Date.now(),
              },
            });
          }
        }
      } catch (tikErr) {
        console.error("TikWM Error:", tikErr);
      }
    }

    // 2. YOUTUBE ENGINE (@hiudyy/ytdl / ruhend-scraper)
    if (platform === "youtube" && ytId) {
      try {
        let hiudyy = null;
        try { hiudyy = require("@hiudyy/ytdl"); } catch (e) {}
        if (hiudyy && typeof hiudyy.downloadYouTube === "function") {
          const ytRes = await hiudyy.downloadYouTube(cleanUrl);
          if (ytRes && (ytRes.filePath || ytRes.url)) {
            const ytMeta = await fetchYouTubeMetadata(ytId);
            const downloadUrl = ytRes.filePath || ytRes.url;
            return res.status(200).json({
              status: "success",
              url: downloadUrl,
              info: {
                id: ytId,
                url: cleanUrl,
                downloadUrl: downloadUrl,
                title: ytRes.title || ytMeta.title,
                author: ytRes.author || ytMeta.author,
                thumbnail: ytRes.thumbnail || ytMeta.thumbnail,
                platform: "youtube",
                quality: `${isAudioOnly ? audioFormat.toUpperCase() : "HD MP4"}`,
                isAudioOnly: isAudioOnly,
                filename: `youtube_${ytId}.${isAudioOnly ? audioFormat : "mp4"}`,
                timestamp: Date.now(),
              },
            });
          }
        }
      } catch (ytErr) {
        console.error("Ytdl Library Error:", ytErr);
      }

      // Ruhend scraper fallback
      try {
        let ruhend = null;
        try { ruhend = require("ruhend-scraper"); } catch (e) {}
        if (ruhend && (ruhend.ytdl || ruhend.ytmp4 || ruhend.ytmp3)) {
          const fn = isAudioOnly ? (ruhend.ytmp3 || ruhend.ytdl) : (ruhend.ytmp4 || ruhend.ytdl);
          const rRes = await fn(cleanUrl);
          if (rRes && (rRes.video || rRes.audio || rRes.link || rRes.url)) {
            const downloadUrl = rRes.video || rRes.audio || rRes.link || rRes.url;
            const ytMeta = await fetchYouTubeMetadata(ytId);
            return res.status(200).json({
              status: "success",
              url: downloadUrl,
              info: {
                id: ytId,
                url: cleanUrl,
                downloadUrl: downloadUrl,
                title: rRes.title || ytMeta.title,
                author: ytMeta.author,
                thumbnail: rRes.thumbnail || ytMeta.thumbnail,
                platform: "youtube",
                quality: `${isAudioOnly ? audioFormat.toUpperCase() : "HD MP4"}`,
                isAudioOnly: isAudioOnly,
                filename: `youtube_${ytId}.${isAudioOnly ? audioFormat : "mp4"}`,
                timestamp: Date.now(),
              },
            });
          }
        }
      } catch (rErr) {
        console.error("Ruhend Error:", rErr);
      }
    }

    // 3. MULTI-INSTANCE COBALT ENGINE (Instagram, Twitter/X, Facebook, Pinterest, YouTube Fallback)
    const customCobalt = process.env.COBALT_API_URL;
    const instances = [
      customCobalt,
      "https://cobaltapi.cjs.nz",
      "https://api.cobalt.tools",
      "https://cobalt.qet.fi",
      "https://co.wuk.sh",
      "https://cobalt.api.scrapes.workers.dev"
    ].filter(Boolean);

    for (const inst of instances) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const cobaltRes = await fetch(`${inst.replace(/\/$/, "")}/`, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            ...(process.env.COBALT_API_KEY ? { "Authorization": `Api-Key ${process.env.COBALT_API_KEY}` } : {}),
          },
          body: JSON.stringify({
            url: cleanUrl,
            videoQuality: videoQuality === "max" ? "max" : videoQuality,
            audioFormat: audioFormat || "mp3",
            downloadMode: isAudioOnly ? "audio" : "auto",
            youtubeVideoCodec: "h264",
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (cobaltRes.ok) {
          const data = await cobaltRes.json();
          const downloadUrl = data.url || (data.picker && data.picker[0]?.url);
          if (downloadUrl && typeof downloadUrl === "string") {
            const platformName = platform !== "unknown" ? platform.toUpperCase() : "Medya";
            const fileExt = isAudioOnly ? audioFormat : "mp4";
            const videoTitle = data.filename || `${platformName} Video`;
            const ytMeta = ytId ? await fetchYouTubeMetadata(ytId) : null;

            return res.status(200).json({
              status: "success",
              url: downloadUrl,
              audioUrl: data.audio || null,
              picker: data.picker || null,
              info: {
                id: Buffer.from(cleanUrl).toString("base64").slice(0, 16),
                url: cleanUrl,
                downloadUrl: downloadUrl,
                title: ytMeta ? ytMeta.title : videoTitle,
                platform: platform,
                thumbnail: ytMeta ? ytMeta.thumbnail : (data.picker ? data.picker[0]?.thumb : null),
                quality: isAudioOnly ? `${audioFormat.toUpperCase()} (Ses)` : `${videoQuality}p MP4`,
                isAudioOnly: isAudioOnly,
                filename: data.filename || `video_${Date.now()}.${fileExt}`,
                timestamp: Date.now(),
              },
            });
          }
        }
      } catch (err) {}
    }

    // 4. LAST-RESORT YOUTUBE DIRECT PARSER
    if (platform === "youtube" && ytId) {
      const ytMeta = await fetchYouTubeMetadata(ytId);
      // Invidious instances fallback
      const invidiousInstances = [
        "https://inv.tux.pizza",
        "https://invidious.drgns.space",
        "https://invidious.flokinet.to"
      ];
      for (const inv of invidiousInstances) {
        try {
          const invRes = await fetch(`${inv}/api/v1/videos/${ytId}`, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (invRes.ok) {
            const invData = await invRes.json();
            const formatStreams = invData.formatStreams || [];
            const audioStreams = invData.adaptiveFormats?.filter(f => f.type?.includes("audio")) || [];
            const selectedStream = isAudioOnly ? (audioStreams[0] || formatStreams[0]) : (formatStreams[0] || audioStreams[0]);
            if (selectedStream && selectedStream.url) {
              return res.status(200).json({
                status: "success",
                url: selectedStream.url,
                info: {
                  id: ytId,
                  url: cleanUrl,
                  downloadUrl: selectedStream.url,
                  title: invData.title || ytMeta.title,
                  author: invData.author || ytMeta.author,
                  thumbnail: ytMeta.thumbnail,
                  platform: "youtube",
                  quality: isAudioOnly ? `${audioFormat.toUpperCase()} (Ses)` : `${selectedStream.qualityLabel || "HD"} MP4`,
                  isAudioOnly: isAudioOnly,
                  filename: `youtube_${ytId}.${isAudioOnly ? audioFormat : "mp4"}`,
                  timestamp: Date.now(),
                },
              });
            }
          }
        } catch (e) {}
      }
    }

    return res.status(400).json({
      status: "error",
      error: "Video çözümlenemedi. Video gizli veya silinmiş olabilir. Lütfen linki kontrol edip tekrar deneyin.",
    });
  } catch (error) {
    console.error("Download API Error:", error);
    return res.status(500).json({
      status: "error",
      error: "Sunucu hatası meydana geldi. Lütfen birazdan tekrar deneyin.",
    });
  }
};
