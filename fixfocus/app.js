/* FixFocus: YouTube, but only videos that help you fix things.
 *
 * Runs entirely in the browser. Searches with the official YouTube Data API v3
 * (an API key, no sign-in), keeps only repair/how-to videos, and plays them
 * embedded here so YouTube's recommendations can't pull you away.
 */
(() => {
  "use strict";

  const API = "https://www.googleapis.com/youtube/v3/";
  const RESULTS = 25;                     // videos requested per search
  const CACHE_MS = 24 * 3600e3;           // reuse a search's results for a day (saves API quota)
  const MAX_RECENT = 8;
  const F = window.FixFilter;

  const CATEGORIES = [
    ["🏠 Home", "home repair"], ["🚰 Plumbing", "plumbing"], ["🔌 Electrical", "electrical outlet switch"],
    ["🚗 Car", "car"], ["📱 Phone", "phone"], ["💻 Computer", "computer"], ["🧺 Appliances", "appliance"],
    ["🚲 Bike", "bike"], ["👕 Clothes", "clothes sewing"], ["🪑 Furniture", "furniture"], ["🌱 Yard", "lawn mower yard"],
  ];

  // ---------- storage helpers (never throw) ----------
  const store = {
    get(key, fallback = null) {
      try { const v = localStorage.getItem("fixfocus." + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem("fixfocus." + key, JSON.stringify(value)); } catch { /* full/blocked */ } },
    del(key) { try { localStorage.removeItem("fixfocus." + key); } catch { /* ignore */ } },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const views = { setup: $("setupView"), search: $("searchView"), player: $("playerView") };
  const el = {
    actions: $("actions"), menuBtn: $("menuBtn"), menu: $("menu"), clearBtn: $("clearBtn"), changeKeyBtn: $("changeKeyBtn"),
    setupForm: $("setupForm"), keyInput: $("keyInput"), homeLink: $("homeLink"), hero: $("hero"),
    searchForm: $("searchForm"), q: $("q"), categories: $("categories"), recentWrap: $("recentWrap"), recent: $("recent"),
    notice: $("notice"), status: $("status"), results: $("results"), error: $("error"),
    backBtn: $("backBtn"), playerBox: $("playerBox"), playerTitle: $("playerTitle"), playerSub: $("playerSub"),
    fixedBtn: $("fixedBtn"), ytLink: $("ytLink"),
  };

  // ---------- state ----------
  const cfg = window.FIXFOCUS_CONFIG || {};
  let apiKey = (cfg.apiKey || "").trim() || store.get("apiKey", "");
  let fixed = store.get("fixed", {});    // videoId -> timestamp
  let recent = store.get("recent", []);  // recent search strings
  let current = null;                    // video open in the player
  let searching = false;

  function show(name) {
    for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
    el.actions.hidden = name === "setup";
    if (name !== "player") el.playerBox.replaceChildren(); // stop playback
  }
  function showError(msg) { el.error.textContent = msg || ""; el.error.hidden = !msg; }
  function notice(msg) { el.notice.textContent = msg || ""; el.notice.hidden = !msg; }

  // API text comes HTML-escaped ("&#39;"). Decode without ever inserting HTML.
  function decode(s) {
    const t = document.createElement("textarea");
    t.innerHTML = s || "";
    return t.value;
  }

  // ---------- YouTube Data API ----------
  class ApiError extends Error {
    constructor(status, reason, message) { super(message); this.status = status; this.reason = reason; }
  }
  async function api(path, params) {
    const res = await fetch(API + path + "?" + new URLSearchParams({ ...params, key: apiKey }));
    if (res.ok) return res.json();
    let reason = "", message = res.statusText;
    try {
      const body = await res.json();
      reason = body.error?.errors?.[0]?.reason || body.error?.status || "";
      message = body.error?.message || message;
    } catch { /* non-JSON */ }
    throw new ApiError(res.status, reason, message);
  }

  function friendlyError(e) {
    if (e instanceof ApiError) {
      if (e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded")
        return "YouTube's daily search limit for this app was reached. It resets at midnight Pacific time. Searches you already made still work.";
      if (e.reason === "keyInvalid" || /API key not valid/i.test(e.message))
        return "That API key isn't valid. Open ⋯ → Change API key.";
      if (e.reason === "accessNotConfigured" || e.reason === "SERVICE_DISABLED")
        return "The YouTube Data API v3 isn't enabled in your Google Cloud project yet. See SETUP.md.";
      if (e.status === 403 && /referer|referrer/i.test(e.message))
        return "This API key isn't allowed on this website. Add this site's address to the key's website restrictions (SETUP.md step 3).";
      return "YouTube error: " + e.message;
    }
    return e?.message || String(e);
  }

  async function searchYouTube(query) {
    const cacheKey = "cache." + query.toLowerCase();
    const cached = store.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.videos;

    const data = await api("search", {
      part: "snippet", type: "video", q: query, maxResults: String(RESULTS),
      safeSearch: "strict", videoEmbeddable: "true", relevanceLanguage: (navigator.language || "en").slice(0, 2),
    });
    const ids = (data.items || []).map((it) => it.id.videoId).filter(Boolean);
    if (!ids.length) return [];

    // One cheap extra call for full descriptions, durations and view counts.
    const details = await api("videos", { part: "snippet,contentDetails,statistics", id: ids.join(","), maxResults: "50" });
    const byId = new Map((details.items || []).map((v) => [v.id, v]));
    const videos = ids.map((id) => byId.get(id)).filter(Boolean).map((v) => ({
      id: v.id,
      title: decode(v.snippet.title),
      description: decode(v.snippet.description).slice(0, 600),
      channelTitle: decode(v.snippet.channelTitle),
      publishedAt: v.snippet.publishedAt,
      thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
      durationSec: F.parseDuration(v.contentDetails?.duration),
      views: Number(v.statistics?.viewCount || 0),
    })).filter(F.isFixVideo);

    store.set(cacheKey, { at: Date.now(), videos });
    pruneCache();
    return videos;
  }

  function pruneCache() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith("fixfocus.cache.")) keys.push([k, JSON.parse(localStorage.getItem(k))?.at || 0]);
      }
      keys.sort((a, b) => b[1] - a[1]).slice(30).forEach(([k]) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }

  // ---------- search ----------
  async function runSearch(raw, { push = true } = {}) {
    if (searching) return;
    showError(""); notice("");
    const check = F.checkQuery(raw);
    if (!check.ok) { notice(check.reason); return; }
    const query = F.buildQuery(raw);
    el.q.value = raw.trim();
    if (push) history.pushState({ q: raw.trim() }, "", "?q=" + encodeURIComponent(raw.trim()));
    show("search");
    el.hero.hidden = true;
    addRecent(raw.trim());

    searching = true;
    el.status.textContent = "Finding fixes…";
    el.results.replaceChildren();
    try {
      const videos = await searchYouTube(query);
      renderResults(videos);
      el.status.textContent = videos.length
        ? `${videos.length} fix video${videos.length > 1 ? "s" : ""} for "${query}"`
        : "";
      if (!videos.length) notice("No repair videos found. Try naming the thing and the problem, like \"dishwasher not draining\".");
    } catch (e) {
      el.status.textContent = "";
      showError(friendlyError(e));
    } finally {
      searching = false;
    }
  }

  function addRecent(q) {
    recent = [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    store.set("recent", recent);
    renderRecent();
  }

  // ---------- rendering ----------
  function fmtDuration(s) {
    if (s == null) return "";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }
  function fmtViews(n) {
    if (!n) return "";
    const f = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
    return f.format(n) + " views";
  }

  function renderResults(videos) {
    const frag = document.createDocumentFragment();
    for (const v of videos) frag.appendChild(resultRow(v));
    el.results.replaceChildren(frag);
  }

  function resultRow(v) {
    const li = document.createElement("li");
    li.className = "video" + (fixed[v.id] ? " fixed" : "");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "link";
    b.addEventListener("click", () => openVideo(v));

    const tw = document.createElement("span");
    tw.className = "thumbwrap";
    const img = document.createElement("img");
    img.className = "thumb"; img.loading = "lazy"; img.alt = ""; img.referrerPolicy = "no-referrer";
    if (v.thumb) img.src = v.thumb;
    const dur = document.createElement("span");
    dur.className = "dur"; dur.textContent = fmtDuration(v.durationSec);
    tw.append(img, dur);

    const meta = document.createElement("span");
    meta.className = "meta";
    const title = document.createElement("span");
    title.className = "title"; title.textContent = v.title;
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = [v.channelTitle, fmtViews(v.views)].filter(Boolean).join(" · ");
    meta.append(title, sub);
    if (fixed[v.id]) {
      const tag = document.createElement("span");
      tag.className = "tag"; tag.textContent = "✓ Fixed it with this";
      meta.append(tag);
    }
    b.append(tw, meta);
    li.append(b);
    return li;
  }

  function renderCategories() {
    el.categories.replaceChildren(...CATEGORIES.map(([label, q]) => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip"; c.textContent = label;
      c.addEventListener("click", () => { el.q.value = q + " "; el.q.focus(); notice(`Now say what's wrong with it, like "${q} won't turn on".`); });
      return c;
    }));
  }

  function renderRecent() {
    el.recentWrap.hidden = recent.length === 0;
    el.recent.replaceChildren(...recent.map((q) => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip"; c.textContent = q;
      c.addEventListener("click", () => runSearch(q));
      return c;
    }));
  }

  // ---------- player ----------
  function openVideo(v) {
    current = v;
    // youtube-nocookie + rel=0: no personalized recommendations at the end.
    // A fresh iframe each time, so the player never adds entries to the Back button's history.
    const frame = document.createElement("iframe");
    frame.title = v.title;
    frame.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(v.id) +
      "?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&autoplay=1";
    el.playerBox.replaceChildren(frame);
    el.playerTitle.textContent = v.title;
    el.playerSub.textContent = [v.channelTitle, fmtViews(v.views), fmtDuration(v.durationSec)].filter(Boolean).join(" · ");
    el.ytLink.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(v.id);
    updateFixedBtn();
    show("player");
    history.pushState({ q: el.q.value, v: v.id }, "", location.search);
    window.scrollTo(0, 0);
  }
  function updateFixedBtn() {
    const on = current && fixed[current.id];
    el.fixedBtn.textContent = on ? "✓ Fixed! (tap to undo)" : "✓ I fixed it";
    el.fixedBtn.classList.toggle("done", !!on);
  }
  function closePlayer() {
    show("search");
    const q = el.q.value.trim();
    if (q) runSearch(q, { push: false }); // re-render (cached, no API cost) to show fixed tags
  }

  // ---------- events ----------
  el.setupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = el.keyInput.value.trim();
    if (!/^AIza[0-9A-Za-z_-]{30,}$/.test(v)) { showError("That doesn't look like a YouTube API key. It should start with AIza."); return; }
    store.set("apiKey", v);
    location.reload();
  });

  el.searchForm.addEventListener("submit", (e) => { e.preventDefault(); runSearch(el.q.value); });
  el.backBtn.addEventListener("click", () => history.back());
  el.fixedBtn.addEventListener("click", () => {
    if (!current) return;
    if (fixed[current.id]) delete fixed[current.id]; else fixed[current.id] = Date.now();
    store.set("fixed", fixed);
    updateFixedBtn();
  });

  window.addEventListener("popstate", (e) => {
    const q = e.state?.q || new URLSearchParams(location.search).get("q") || "";
    if (!views.player.hidden) { closePlayer(); return; }
    if (q) runSearch(q, { push: false });
    else { show("search"); el.hero.hidden = false; el.results.replaceChildren(); el.status.textContent = ""; el.q.value = ""; notice(""); }
  });

  el.menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.menu.hidden = !el.menu.hidden;
    el.menuBtn.setAttribute("aria-expanded", String(!el.menu.hidden));
  });
  document.addEventListener("click", () => { el.menu.hidden = true; el.menuBtn.setAttribute("aria-expanded", "false"); });

  el.clearBtn.addEventListener("click", () => {
    recent = []; fixed = {};
    try { Object.keys(localStorage).filter((k) => k.startsWith("fixfocus.") && k !== "fixfocus.apiKey").forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    renderRecent();
    el.results.replaceChildren();
    el.status.textContent = "History cleared.";
  });
  el.changeKeyBtn.addEventListener("click", () => {
    if (cfg.apiKey) { showError("The API key is set in config.js. Edit that file to change it."); return; }
    store.del("apiKey");
    location.reload();
  });

  // ---------- start ----------
  function start() {
    if (!apiKey) { show("setup"); return; }
    renderCategories();
    renderRecent();
    show("search");
    const q = new URLSearchParams(location.search).get("q");
    if (q) runSearch(q, { push: false });
    else el.q.focus();
  }
  start();
})();
