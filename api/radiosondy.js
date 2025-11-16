// /api/radiosondy.js – Vercel Serverless Function (CommonJS)
// Proxy do radiosondy.info z cache 30 s

const https = require("https");

const UPSTREAM_URL =
  "https://radiosondy.info/export/export_search.php?csv=1&search_limit=200";

let cacheData = null;
let cacheTs = 0; // ms

module.exports = (req, res) => {
  // CORS / preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const now = Date.now();

  // Świeży cache < 30 s
  if (cacheData && now - cacheTs < 30000) {
    res.setHeader("X-Proxy-Cache", "hit");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(cacheData);
  }

  // Pobieramy CSV przez https.get z timeoutem
  const request = https.get(UPSTREAM_URL, (upRes) => {
    if (upRes.statusCode < 200 || upRes.statusCode >= 300) {
      // Upstream error – jeśli mamy cache, zwracamy stale
      if (cacheData) {
        res.setHeader("X-Proxy-Warn", "stale-cache");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send(cacheData);
      }
      return res
        .status(upRes.statusCode || 502)
        .send("Upstream error " + upRes.statusCode);
    }

    let body = "";

    upRes.setEncoding("utf8");
    upRes.on("data", (chunk) => {
      body += chunk;
    });

    upRes.on("end", () => {
      cacheData = body;
      cacheTs = Date.now();

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(body);
    });
  });

  // Timeout 30 s
  request.setTimeout(30000, () => {
    request.destroy(new Error("timeout"));
  });

  request.on("error", (err) => {
    if (cacheData) {
      res.setHeader("X-Proxy-Warn", "stale-cache");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(cacheData);
    }
    const msg = String(err && err.message ? err.message : err);
    if (msg.toLowerCase().includes("timeout")) {
      return res.status(504).send("timeout connecting to radiosondy.info");
    }
    return res.status(502).send("proxy error: " + msg);
  });
};
