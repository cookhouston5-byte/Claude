"use strict";

const assert = require("assert");
const { describe, test, after } = require("node:test");
const { createApp } = require("./server");

const SECRET = "TESTKEY-do-not-leak-1234567890";

function video(id, title, description, duration, channelTitle) {
  return {
    id,
    snippet: {
      title,
      description,
      channelTitle: channelTitle || "Repair Channel",
      publishedAt: "2024-06-01T12:00:00Z",
      thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
    },
    contentDetails: { duration },
    statistics: { viewCount: "1200" },
  };
}

function youtubeMock(calls) {
  return async (url) => {
    const parsed = new URL(url);
    calls.push(parsed.toString());
    assert.equal(parsed.searchParams.get("key"), SECRET);
    if (parsed.pathname.endsWith("/search")) {
      return jsonResponse(200, {
        items: [
          { id: { videoId: "abcdefghijk" } },
          { id: { videoId: "shortvideoid" } },
          { id: { videoId: "funnyvideoid" } },
          { id: { videoId: "lyricvideoid" } },
          { id: { videoId: "bad id" } },
        ],
      });
    }
    return jsonResponse(200, {
      items: [
        video("abcdefghijk", "How to fix a leaky faucet", "A repair guide", "PT5M12S"),
        video("shortvideoid", "Fix it fast #shorts", "how to fix", "PT20S"),
        video("funnyvideoid", "Funniest plumbing fails compilation", "how to fix", "PT4M"),
        video("lyricvideoid", "I Can Fix Him (No Really I Can)", "", "PT3M30S", "Taylor Swift - Topic"),
      ],
    });
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function get(port, path, headers) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* html or plain text */ }
  return { status: res.status, body, text };
}

describe("FixFocus server", () => {
  const servers = [];
  after(() => servers.forEach((server) => server.close()));

  async function start(options) {
    const server = createApp(options);
    servers.push(server);
    const port = await listen(server);
    return port;
  }

  test("missing key tells visitors the site is unavailable and does not ask for a key", async () => {
    const port = await start({ apiKey: "" });
    const status = await get(port, "/api/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.available, false);

    const search = await get(port, "/api/search?q=leaky%20faucet");
    assert.equal(search.status, 503);
    assert.match(search.body.message, /temporarily unavailable/i);
    assert.doesNotMatch(search.text, /api key/i);
    assert.doesNotMatch(search.text, /AIza/);
  });

  test("search filters to repair videos and never returns the key", async () => {
    const calls = [];
    const port = await start({ apiKey: SECRET, fetchImpl: youtubeMock(calls) });
    const result = await get(port, "/api/search?q=leaky%20faucet");
    assert.equal(result.status, 200);
    assert.equal(result.body.query, "how to fix leaky faucet");
    assert.deepEqual(result.body.videos.map((video) => video.id), ["abcdefghijk"]);
    assert.equal(result.body.videos[0].title, "How to fix a leaky faucet");
    assert.equal(result.body.videos[0].durationSec, 312);
    assert.equal(result.body.videos[0].thumb, "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg");
    assert.equal("description" in result.body.videos[0], false);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(result.text, /TESTKEY/);
    assert.doesNotMatch(result.text, /googleapis.com/);
  });

  test("an identical search is served from cache", async () => {
    const calls = [];
    const port = await start({ apiKey: SECRET, fetchImpl: youtubeMock(calls) });
    await get(port, "/api/search?q=leaky%20faucet");
    const again = await get(port, "/api/search?q=leaky%20faucet");
    assert.equal(again.status, 200);
    assert.equal(again.body.videos.length, 1);
    assert.equal(calls.length, 2);
  });

  test("a query with no real word does not call YouTube", async () => {
    const calls = [];
    const port = await start({ apiKey: SECRET, fetchImpl: youtubeMock(calls) });
    const result = await get(port, "/api/search?q=" + encodeURIComponent("%%%&&&"));
    assert.equal(result.status, 400);
    assert.match(result.body.message, /words/i);
    assert.equal(calls.length, 0);
  });

  test("distraction searches are refused before YouTube is called", async () => {
    const calls = [];
    const port = await start({ apiKey: SECRET, fetchImpl: youtubeMock(calls) });
    const result = await get(port, "/api/search?q=funny%20cat%20videos");
    assert.equal(result.status, 400);
    assert.match(result.body.message, /repair videos/i);
    assert.equal(calls.length, 0);
  });

  test("a YouTube quota error becomes a plain message and hides the key", async () => {
    const port = await start({
      apiKey: SECRET,
      fetchImpl: async () => jsonResponse(403, {
        error: { errors: [{ reason: "quotaExceeded", message: `key ${SECRET} quota` }], message: `key ${SECRET} quota` },
      }),
    });
    const result = await get(port, "/api/search?q=squeaky%20hinge");
    assert.equal(result.status, 429);
    assert.match(result.body.message, /midnight Pacific time/);
    assert.doesNotMatch(result.text, /TESTKEY/);
  });

  test("an invalid key becomes the same unavailable message", async () => {
    const port = await start({
      apiKey: SECRET,
      fetchImpl: async () => jsonResponse(400, {
        error: { errors: [{ reason: "keyInvalid" }], message: `API key ${SECRET} not valid` },
      }),
    });
    const result = await get(port, "/api/search?q=dripping%20tap");
    assert.equal(result.status, 503);
    assert.match(result.body.message, /temporarily unavailable/i);
    assert.doesNotMatch(result.text, /TESTKEY/);
  });

  test("per-minute limit stops a burst of new searches", async () => {
    let n = 0;
    const port = await start({
      apiKey: SECRET,
      limits: { perMinute: 2, perDay: 20, globalDaily: 90 },
      fetchImpl: async (url) => {
        n += 1;
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/search")) {
          return jsonResponse(200, { items: [{ id: { videoId: "abcdefghijk" } }] });
        }
        return jsonResponse(200, { items: [video("abcdefghijk", "How to fix it", "repair guide", "PT3M")] });
      },
    });
    assert.equal((await get(port, "/api/search?q=leaky%20faucet")).status, 200);
    assert.equal((await get(port, "/api/search?q=squeaky%20hinge")).status, 200);
    const blocked = await get(port, "/api/search?q=dripping%20tap");
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.message, /Wait a minute/);
    assert.ok(n >= 2);
  });

  test("a cached search still works after the daily cap is reached", async () => {
    const port = await start({
      apiKey: SECRET,
      limits: { perMinute: 10, perDay: 1, globalDaily: 1 },
      fetchImpl: youtubeMock([]),
    });
    assert.equal((await get(port, "/api/search?q=leaky%20faucet")).status, 200);
    const capped = await get(port, "/api/search?q=squeaky%20hinge");
    assert.equal(capped.status, 429);
    assert.match(capped.body.message, /today's search limit/);
    const cached = await get(port, "/api/search?q=leaky%20faucet");
    assert.equal(cached.status, 200);
    assert.equal(cached.body.videos[0].id, "abcdefghijk");
  });

  test("cross-site requests are rejected", async () => {
    const calls = [];
    const port = await start({ apiKey: SECRET, fetchImpl: youtubeMock(calls) });
    const result = await get(port, "/api/search?q=leaky%20faucet", { Origin: "https://evil.example" });
    assert.equal(result.status, 403);
    assert.equal(calls.length, 0);
  });

  test("static pages are served and the key is not in them", async () => {
    const port = await start({ apiKey: SECRET, fetchImpl: youtubeMock([]) });
    const home = await get(port, "/");
    assert.equal(home.status, 200);
    assert.match(home.text, /What needs fixing/);
    assert.match(home.text, /temporarily unavailable/i);
    assert.doesNotMatch(home.text, /One-time setup/);
    assert.doesNotMatch(home.text, /TESTKEY/);
    assert.doesNotMatch(home.text, /AIza/);
    assert.equal((await get(port, "/privacy.html")).status, 200);
    assert.equal((await get(port, "/terms.html")).status, 200);
    assert.equal((await get(port, "/server.js")).status, 404);
    assert.equal((await get(port, "/config.js")).status, 404);
    assert.equal((await get(port, "/%2e%2e/package.json")).status, 404);
    const js = await get(port, "/app.js");
    assert.equal(js.status, 200);
    assert.match(js.text, /\/api\/search/);
    assert.doesNotMatch(js.text, /https:\/\/www\.googleapis\.com/);
    assert.doesNotMatch(js.text, /AIza[0-9A-Za-z_-]{10}/);
    assert.doesNotMatch(js.text, /[?&]key=/);
    assert.doesNotMatch(js.text, /YOUTUBE_API_KEY/);
  });
});
