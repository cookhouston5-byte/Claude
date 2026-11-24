/* FixFocus server.
 *
 * Serves the static site and a single search endpoint. The YouTube Data API
 * key stays in the YOUTUBE_API_KEY environment variable and is never sent to
 * the browser.
 *
 * Quota protection, all in memory (the free host forgets it on restart):
 * - identical searches are reused for 24 hours
 * - each visitor is limited per minute and per day
 * - the whole site stops making new YouTube searches after a daily cap
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const filter = require("./filter");

const ROOT = __dirname;
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const DEFAULT_LIMITS = {
  perMinute: 12,
  perDay: 20,
  globalDaily: 90,
};

const UNAVAILABLE = "FixFocus is temporarily unavailable. Please check back soon.";
const QUOTA_MESSAGE = "FixFocus has used today's YouTube search allowance. It resets at midnight Pacific time. Searches already made today still work.";
const UPSTREAM_MESSAGE = "FixFocus couldn't reach YouTube just now. Please try again in a few minutes.";
const RATE_MESSAGE = "Too many searches in a short time. Wait a minute and try again.";
const DAY_MESSAGE = "You've used today's search limit for this connection. It resets within 24 hours. Searches you already made still work.";

const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"]);
const DOWN_REASONS = new Set([
  "keyInvalid",
  "badRequest",
  "accessNotConfigured",
  "forbidden",
  "SERVICE_DISABLED",
  "ipRefererBlocked",
  "API_KEY_HTTP_REFERRER_BLOCKED",
]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

const BLOCKED_FILES = new Set(["server.js", "server.test.js", "test.js", "package.json", "package-lock.json"]);

function createApp(options = {}) {
  const apiKey = String(options.apiKey ?? process.env.YOUTUBE_API_KEY ?? "").trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };

  const cache = new Map();
  const inflight = new Map();
  const visitors = new Map();
  const quota = { dayStart: Date.now(), count: 0 };

  function clientIp(req) {
    const remote = req.socket?.remoteAddress || "unknown";
    const forwarded = req.headers["x-forwarded-for"];
    if (process.env.RENDER && typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }
    return remote;
  }

  function hostOf(value) {
    try { return new URL(value).host.toLowerCase(); }
    catch { return ""; }
  }

  function sameSite(req) {
    const host = String(req.headers.host || "").toLowerCase();
    if (!host) return false;
    const origin = req.headers.origin;
    const referer = req.headers.referer || req.headers.referrer;
    if (typeof origin === "string" && origin && hostOf(origin) !== host) return false;
    if (typeof referer === "string" && referer && hostOf(referer) !== host) return false;
    return true;
  }

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  }

  function pruneVisitors(now) {
    if (visitors.size < 500) return;
    for (const [ip, bucket] of visitors) {
      if (now - bucket.dayStart > 864e5 && now - bucket.minStart > 60e3) visitors.delete(ip);
    }
  }

  function takeMinute(ip, now) {
    let bucket = visitors.get(ip);
    if (!bucket) {
      bucket = { minStart: now, minCount: 0, dayStart: now, dayCount: 0 };
      visitors.set(ip, bucket);
    }
    if (now - bucket.minStart >= 60e3) { bucket.minStart = now; bucket.minCount = 0; }
    if (now - bucket.dayStart >= 864e5) { bucket.dayStart = now; bucket.dayCount = 0; }
    if (bucket.minCount >= limits.perMinute) return { ok: false, message: RATE_MESSAGE };
    bucket.minCount += 1;
    return { ok: true, bucket };
  }

  function withinDaily(bucket, now) {
    if (now - quota.dayStart >= 864e5) { quota.dayStart = now; quota.count = 0; }
    if (bucket.dayCount >= limits.perDay) return { ok: false, message: DAY_MESSAGE };
    if (quota.count >= limits.globalDaily) return { ok: false, message: QUOTA_MESSAGE };
    return { ok: true };
  }

  function trimCache() {
    if (cache.size <= CACHE_MAX) return;
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }

  function safeThumb(url) {
    if (typeof url !== "string") return "";
    if (url.startsWith("https://i.ytimg.com/") || url.startsWith("https://yt3.ggpht.com/")) return url;
    return "";
  }

  function fromEntity(raw, match) {
    const code = Number(raw);
    if (!Number.isInteger(code) || code < 0 || code > 0x10FFFF) return match;
    try { return String.fromCodePoint(code); } catch { return match; }
  }

  function decodeText(value) {
    return String(value || "")
      .replace(/&#(\d+);/g, (match, n) => fromEntity(n, match))
      .replace(/&#x([0-9a-f]+);/gi, (match, n) => fromEntity(parseInt(n, 16), match))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  async function youtube(pathname, params) {
    const url = new URL("https://www.googleapis.com/youtube/v3/" + pathname);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("key", apiKey);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (!res.ok) {
      const error = new Error("youtube");
      error.status = res.status;
      error.reason = body.error?.errors?.[0]?.reason || body.error?.status || "";
      throw error;
    }
    return body;
  }

  async function searchYouTube(query) {
    const data = await youtube("search", {
      part: "snippet",
      type: "video",
      q: query,
      maxResults: "25",
      safeSearch: "strict",
      videoEmbeddable: "true",
      relevanceLanguage: "en",
    });
    const ids = (data.items || [])
      .map((item) => item.id?.videoId)
      .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id || ""));
    if (!ids.length) return [];

    const details = await youtube("videos", {
      part: "snippet,contentDetails,statistics",
      id: ids.join(","),
      maxResults: "50",
    });
    const byId = new Map((details.items || []).map((video) => [video.id, video]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map((video) => ({
      id: video.id,
      title: decodeText(video.snippet?.title),
      description: decodeText(video.snippet?.description).slice(0, 600),
      channelTitle: decodeText(video.snippet?.channelTitle),
      publishedAt: video.snippet?.publishedAt || "",
      thumb: safeThumb(video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || ""),
      durationSec: filter.parseDuration(video.contentDetails?.duration),
      views: Number(video.statistics?.viewCount || 0),
    })).filter(filter.isFixVideo).map(({ description, ...video }) => video);
  }

  function sendSearchError(res, error) {
    if (QUOTA_REASONS.has(error.reason)) {
      return sendJson(res, 429, { error: "quota", message: QUOTA_MESSAGE });
    }
    const detail = error.reason || (error.name === "TimeoutError" ? "timeout" : "error");
    console.error("YouTube request failed", error.status || "", detail);
    if (DOWN_REASONS.has(error.reason)) {
      return sendJson(res, 503, { error: "unavailable", message: UNAVAILABLE });
    }
    return sendJson(res, 502, { error: "upstream", message: UPSTREAM_MESSAGE });
  }

  async function handleSearch(req, res, url) {
    if (!apiKey) return sendJson(res, 503, { error: "unavailable", message: UNAVAILABLE });
    if (!sameSite(req)) {
      return sendJson(res, 403, { error: "forbidden", message: "FixFocus only accepts searches from its own site." });
    }

    const now = Date.now();
    pruneVisitors(now);
    const minute = takeMinute(clientIp(req), now);
    if (!minute.ok) return sendJson(res, 429, { error: "rate", message: minute.message });

    const raw = String(url.searchParams.get("q") || "");
    if (raw.length > 120) {
      return sendJson(res, 400, { error: "rejected", message: "That search is too long. Describe the problem in a few words." });
    }
    const check = filter.checkQuery(raw);
    if (!check.ok) return sendJson(res, 400, { error: "rejected", message: check.reason });

    const query = filter.buildQuery(raw);
    const cacheKey = query.toLowerCase();
    const hit = cache.get(cacheKey);
    if (hit && now - hit.at < CACHE_MS) return sendJson(res, 200, { query, videos: hit.videos });

    if (inflight.has(cacheKey)) {
      try {
        const videos = await inflight.get(cacheKey);
        return sendJson(res, 200, { query, videos });
      } catch (error) {
        return sendSearchError(res, error);
      }
    }

    const daily = withinDaily(minute.bucket, now);
    if (!daily.ok) return sendJson(res, 429, { error: "quota", message: daily.message });

    const pending = searchYouTube(query).then((videos) => {
      cache.set(cacheKey, { at: Date.now(), videos });
      trimCache();
      minute.bucket.dayCount += 1;
      quota.count += 1;
      return videos;
    });
    inflight.set(cacheKey, pending);

    try {
      // Await the finally-wrapper so a YouTube failure is handled here.
      // A bare pending.finally() would reject on its own and crash the process.
      const videos = await pending.finally(() => {
        if (inflight.get(cacheKey) === pending) inflight.delete(cacheKey);
      });
      return sendJson(res, 200, { query, videos });
    } catch (error) {
      return sendSearchError(res, error);
    }
  }

  function staticPath(urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath.split("?")[0]); }
    catch { return null; }
    const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    if (!rel || rel.includes("\0")) return null;
    const full = path.resolve(ROOT, rel);
    if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
    if (BLOCKED_FILES.has(path.basename(full))) return null;
    const ext = path.extname(full).toLowerCase();
    if (!TYPES[ext]) return null;
    return full;
  }

  function sendFile(req, res, file) {
    fs.readFile(file, (error, buf) => {
      if (error) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "Content-Type": TYPES[ext],
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
      });
      res.end(req.method === "HEAD" ? undefined : buf);
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/api/status" && req.method === "GET") {
      return sendJson(res, 200, { available: Boolean(apiKey) });
    }
    if (url.pathname === "/api/search" && req.method === "GET") {
      return handleSearch(req, res, url);
    }
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(req.method === "GET" ? 404 : 405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(req.method === "GET" ? "Not found" : "Method not allowed");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    const file = staticPath(url.pathname);
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      res.end("Not found");
      return;
    }
    sendFile(req, res, file);
  }

  return http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((error) => {
      console.error("Request failed", error && error.message ? error.message : "error");
      if (!res.headersSent) sendJson(res, 500, { error: "server", message: "Something went wrong. Please try again." });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8000;
  createApp().listen(port, () => {
    const state = String(process.env.YOUTUBE_API_KEY || "").trim() ? "ready" : "missing YOUTUBE_API_KEY";
    console.log(`FixFocus listening on ${port} (${state})`);
  });
}

module.exports = { createApp };
