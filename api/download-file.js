module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { url: targetUrl, filename } = req.query || {};

    if (!targetUrl) {
      return res.status(400).send("URL parametresi eksik");
    }

    const safeFilename = filename || `video_${Date.now()}.mp4`;

    const fetchRes = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!fetchRes.ok) {
      return res.redirect(302, targetUrl);
    }

    const contentType = fetchRes.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await fetchRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeFilename)}"`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("File Stream Error:", error);
    if (req.query?.url) {
      return res.redirect(302, req.query.url);
    }
    return res.status(500).send("Dosya aktarılırken hata oluştu");
  }
};
