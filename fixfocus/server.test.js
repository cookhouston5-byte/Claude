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

const SIGNUP_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSeaopJ5k9lzXq0ND9d1nOHVco7f4BYwDWdg9R73ML_xOvCAPA/formResponse";
const SIGNUP_FORM_FIELD = "entry.954349592";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function readResponse(res) {
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* html or plain text */ }
  return { status: res.status, body, text, type: res.headers.get("content-type") };
}

async function get(port, path, headers) {
  return readResponse(await fetch(`http://127.0.0.1:${port}${path}`, { headers }));
}

async function post(port, path, payload) {
  return readResponse(await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  }));
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

  test("robots.txt and sitemap.xml are served for crawlers", async () => {
    const port = await start({ apiKey: "" });
    const robots = await get(port, "/robots.txt");
    assert.equal(robots.status, 200);
    assert.equal(robots.type, "text/plain; charset=utf-8");
    assert.match(robots.text, /User-agent:\s*\*/);
    assert.match(robots.text, /Allow:\s*\//);
    assert.match(robots.text, /Sitemap:\s*https:\/\/fixfocus\.app\/sitemap\.xml/);
    assert.doesNotMatch(robots.text, /Disallow:/i);

    const sitemap = await get(port, "/sitemap.xml");
    assert.equal(sitemap.status, 200);
    assert.equal(sitemap.type, "application/xml; charset=utf-8");
    assert.match(sitemap.text, /<loc>https:\/\/fixfocus\.app\/<\/loc>/);
    assert.match(sitemap.text, /<loc>https:\/\/fixfocus\.app\/privacy\.html<\/loc>/);
    assert.match(sitemap.text, /<loc>https:\/\/fixfocus\.app\/terms\.html<\/loc>/);
  });

  test("the home page explains FixFocus in plain text and offers an optional signup", async () => {
    const port = await start({ apiKey: "" });
    const home = await get(port, "/");
    assert.equal(home.status, 200);
    assert.match(home.text, /<title>FixFocus — Distraction-Free Repair &amp; DIY YouTube Videos<\/title>/);
    assert.match(home.text, /rel="canonical" href="https:\/\/fixfocus\.app\/"/);
    assert.match(home.text, /property="og:image" content="https:\/\/fixfocus\.app\/icon-512\.png"/);
    assert.match(home.text, /name="twitter:card" content="summary"/);
    assert.match(home.text, /Shorts, homepage feeds, or algorithmic recommendations/);
    const jsonLd = home.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLd);
    const structured = JSON.parse(jsonLd[1]);
    assert.deepEqual(structured["@graph"].map((item) => item["@type"]), ["WebApplication", "FAQPage"]);
    assert.ok(structured["@graph"][1].mainEntity.length >= 3);

    const aboutAt = home.text.indexOf('id="about"');
    const signupAt = home.text.indexOf('id="signupForm"');
    const footerAt = home.text.indexOf('<footer class="footer">');
    assert.ok(aboutAt > home.text.indexOf("</main>"));
    assert.ok(signupAt > aboutAt);
    assert.ok(footerAt > signupAt);
    assert.equal(home.text.includes('id="about" hidden'), false);
    assert.match(home.text, /About FixFocus/);
    assert.match(home.text, /Notify me/);
    assert.match(home.text, /id="signupStatus"/);
    assert.match(home.text, /role="status"/);

    const privacy = await get(port, "/privacy.html");
    assert.match(privacy.text, /November 26, 2026/);
    assert.match(privacy.text, /Email updates \(optional\)/);
    assert.match(privacy.text, /Google Sheet/);
    assert.match(privacy.text, /never sold or shared/);
    assert.match(privacy.text, /opt out/i);
    assert.doesNotMatch(privacy.text, /does not ask for your email/i);
  });

  test("a valid email is forwarded to the signup form", async () => {
    const calls = [];
    const port = await start({
      apiKey: "",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse(200, { ignored: true });
      },
    });
    const result = await post(port, "/api/subscribe", { email: "  ada+fix@example.com  " });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, SIGNUP_FORM_URL);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
    const params = new URLSearchParams(calls[0].init.body);
    assert.equal(params.get(SIGNUP_FORM_FIELD), "ada+fix@example.com");
    assert.equal([...params.keys()].length, 1);
  });

  test("signup form url and field can be injected", async () => {
    const calls = [];
    const port = await start({
      apiKey: "",
      signupFormUrl: "https://forms.example.test/submit",
      signupFormField: "entry.111",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: init.body });
        return jsonResponse(200, {});
      },
    });
    const result = await post(port, "/api/subscribe", { email: "ada@example.com" });
    assert.equal(result.status, 200);
    assert.equal(calls[0].url, "https://forms.example.test/submit");
    assert.equal(new URLSearchParams(calls[0].body).get("entry.111"), "ada@example.com");
  });

  test("an invalid email is rejected before the form is called", async () => {
    const calls = [];
    const port = await start({
      apiKey: "",
      signupPerHour: 20,
      fetchImpl: async () => {
        calls.push("called");
        return jsonResponse(200, {});
      },
    });
    for (const email of ["not-an-email", "   ", "a@b", "ada@example.com\nBcc: x"]) {
      const result = await post(port, "/api/subscribe", { email });
      assert.equal(result.status, 400);
      assert.match(result.body.error, /valid email/i);
    }
    const missing = await post(port, "/api/subscribe", {});
    assert.equal(missing.status, 400);
    const broken = await post(port, "/api/subscribe", "{");
    assert.equal(broken.status, 400);
    assert.equal(calls.length, 0);
  });

  test("an upstream signup failure becomes a 502 and hides the form response", async () => {
    const port = await start({
      apiKey: "",
      fetchImpl: async () => jsonResponse(500, { error: "form down SECRET" }),
    });
    const rejected = await post(port, "/api/subscribe", { email: "ada@example.com" });
    assert.equal(rejected.status, 502);
    assert.deepEqual(rejected.body, { error: "Could not save your email right now." });
    assert.doesNotMatch(rejected.text, /SECRET/);

    const down = await start({
      apiKey: "",
      fetchImpl: async () => { throw new Error("connect ECONNREFUSED secret-host"); },
    });
    const failed = await post(down, "/api/subscribe", { email: "ada@example.com" });
    assert.equal(failed.status, 502);
    assert.deepEqual(failed.body, { error: "Could not save your email right now." });
    assert.doesNotMatch(failed.text, /secret-host/);
  });

  test("signup attempts are limited per address", async () => {
    let calls = 0;
    const port = await start({
      apiKey: "",
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(200, {});
      },
    });
    for (let i = 0; i < 5; i++) {
      const result = await post(port, "/api/subscribe", { email: `person${i}@example.com` });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { ok: true });
    }
    const blocked = await post(port, "/api/subscribe", { email: "extra@example.com" });
    assert.equal(blocked.status, 429);
    assert.equal(calls, 5);
    assert.notEqual(blocked.body.ok, true);
  });
});
