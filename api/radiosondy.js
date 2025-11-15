// /api/radiosondy.js – Vercel Serverless Function
// Proxy do radiosondy.info z cache 30 s, timeout 12 s i CORS

const UPSTREAM_URL =
  "https://radiosondy.info/export/export_search.php?csv=1&search_limit=200";

// Cache w pamięci procesu (działa w obrębie pojedynczego workera)
let cacheData = null;
let cacheTs = 0; // ms

export default async function handler(req, res) {
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

  try {
    const now = Date.now();

    // Jeżeli mamy świeży cache (< 30 s) – zwróć od razu
    if (cacheData && now - cacheTs < 30000) {
      res.setHeader("X-Proxy-Cache", "hit");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(cacheData);
    }

    // Upstream fetch z timeoutem 12 s
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const upstreamRes = await fetch(UPSTREAM_URL, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!upstreamRes.ok) {
      // jeżeli upstream padł, ale mamy cache -> stale-cache
      if (cacheData) {
        res.setHeader("X-Proxy-Warn", "stale-cache");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        return res.status(200).send(cacheData);
      }
      return res
        .status(upstreamRes.status || 502)
        .send("Upstream error " + upstreamRes.status);
    }

    const text = await upstreamRes.text();

    // Zapisz cache
    cacheData = text;
    cacheTs = Date.now();

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(text);
  } catch (err) {
    // Timeout lub inny błąd – jeśli mamy cache, zwracamy go jako stale
    if (cacheData) {
      res.setHeader("X-Proxy-Warn", "stale-cache");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(cacheData);
    }

    const isTimeout =
      err && (err.name === "AbortError" || String(err).includes("timeout"));

    return res
      .status(504)
      .send(isTimeout ? "timeout" : "proxy error: " + String(err));
  }
}
