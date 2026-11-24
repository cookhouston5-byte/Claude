/* FixFocus: YouTube, but only videos that help you fix things.
 *
 * The page asks this site's own server to search. The YouTube API key stays
 * on the server. Results are repair and how-to videos, played here so
 * YouTube's recommendations can't pull you away.
 */
(() => {
  "use strict";

  const CACHE_MS = 24 * 3600e3;
  const MAX_RECENT = 8;
  const F = window.FixFilter;

  const CATEGORIES = [
    ["Home", "home repair"],
    ["Plumbing", "plumbing"],
    ["Electrical", "electrical outlet switch"],
    ["Car", "car"],
    ["Phone", "phone"],
    ["Computer", "computer"],
    ["Appliances", "appliance"],
    ["Bike", "bike"],
    ["Clothes", "clothes sewing"],
    ["Furniture", "furniture"],
    ["Yard", "lawn mower yard"],
  ];

  const store = {
    get(key, fallback = null) {
      try { const v = localStorage.getItem("fixfocus." + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem("fixfocus." + key, JSON.stringify(value)); } catch { /* full or blocked */ } },
    del(key) { try { localStorage.removeItem("fixfocus." + key); } catch { /* ignore */ } },
  };

  const $ = (id) => document.getElementById(id);
  const views = { unavailable: $("unavailableView"), search: $("searchView"), player: $("playerView") };
  const el = {
    actions: $("actions"), menuBtn: $("menuBtn"), menu: $("menu"), clearBtn: $("clearBtn"),
    homeLink: $("homeLink"), hero: $("hero"),
    searchForm: $("searchForm"), q: $("q"), categories: $("categories"), recentWrap: $("recentWrap"), recent: $("recent"),
    notice: $("notice"), status: $("status"), results: $("results"), error: $("error"),
    backBtn: $("backBtn"), playerBox: $("playerBox"), playerTitle: $("playerTitle"), playerSub: $("playerSub"),
    fixedBtn: $("fixedBtn"), fixedLabel: $("fixedLabel"), ytLink: $("ytLink"),
  };

  let fixed = store.get("fixed", {});
  let recent = store.get("recent", []);
  let current = null;
  let searching = false;

  function show(name) {
    for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
    el.actions.hidden = name === "unavailable";
    if (name !== "player") el.playerBox.replaceChildren();
  }
  function showError(msg) { el.error.textContent = msg || ""; el.error.hidden = !msg; }
  function notice(msg) { el.notice.textContent = msg || ""; el.notice.hidden = !msg; }

  function publicMessage(error) {
    const message = String(error?.message || "");
    if (/AIza|api[_ ]?key|googleapis/i.test(message)) {
      return "FixFocus is temporarily unavailable. Please check back soon.";
    }
    return message || "Search failed. Please try again.";
  }

  function checkIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M20 6 9 17 4 12");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  async function searchYouTube(raw) {
    const cacheKey = "cache." + raw.trim().toLowerCase();
    const cached = store.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS && Array.isArray(cached.videos)) return cached;

    const res = await fetch("/api/search?q=" + encodeURIComponent(raw.trim()));
    let body = {};
    try { body = await res.json(); } catch { body = {}; }
    if (!res.ok) {
      const error = new Error(body.message || "Search failed. Please try again.");
      error.code = body.error || "";
      throw error;
    }
    const result = { query: body.query || raw, videos: Array.isArray(body.videos) ? body.videos : [] };
    store.set(cacheKey, { at: Date.now(), query: result.query, videos: result.videos });
    pruneCache();
    return result;
  }

  function pruneCache() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("fixfocus.cache.")) keys.push([k, JSON.parse(localStorage.getItem(k))?.at || 0]);
      }
      keys.sort((a, b) => b[1] - a[1]).slice(30).forEach(([k]) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }

  async function runSearch(raw, { push = true } = {}) {
    if (searching) return;
    showError(""); notice("");
    const check = F.checkQuery(raw);
    if (!check.ok) { notice(check.reason); return; }
    el.q.value = raw.trim();
    if (push) history.pushState({ q: raw.trim() }, "", "?q=" + encodeURIComponent(raw.trim()));
    show("search");
    el.hero.hidden = true;
    addRecent(raw.trim());

    searching = true;
    el.status.textContent = "Finding fixes...";
    el.results.replaceChildren();
    try {
      const result = await searchYouTube(raw.trim());
      renderResults(result.videos);
      el.status.textContent = result.videos.length
        ? `${result.videos.length} fix video${result.videos.length > 1 ? "s" : ""} for "${result.query}"`
        : "";
      if (!result.videos.length) notice("No repair videos found. Try naming the thing and the problem, like \"dishwasher not draining\".");
    } catch (e) {
      el.status.textContent = "";
      if (e.code === "unavailable") { show("unavailable"); return; }
      if (e.code === "rejected") notice(publicMessage(e));
      else showError(publicMessage(e));
    } finally {
      searching = false;
    }
  }

  function addRecent(q) {
    recent = [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    store.set("recent", recent);
    renderRecent();
  }

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
      tag.className = "tag";
      tag.append(checkIcon(), document.createTextNode("Fixed it with this"));
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
      c.addEventListener("click", () => {
        el.q.value = q + " ";
        el.q.focus();
        notice(`Now say what's wrong with it, like "${q} won't turn on".`);
      });
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

  function openVideo(v) {
    current = v;
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
    el.fixedLabel.textContent = on ? "Fixed (tap to undo)" : "I fixed it";
    el.fixedBtn.classList.toggle("done", !!on);
  }
  function closePlayer() {
    show("search");
    const q = el.q.value.trim();
    if (q) runSearch(q, { push: false });
  }

  el.searchForm.addEventListener("submit", (e) => { e.preventDefault(); runSearch(el.q.value); });
  el.backBtn.addEventListener("click", () => history.back());
  el.fixedBtn.addEventListener("click", () => {
    if (!current) return;
    if (fixed[current.id]) delete fixed[current.id]; else fixed[current.id] = Date.now();
    store.set("fixed", fixed);
    updateFixedBtn();
  });

  window.addEventListener("popstate", (e) => {
    if (views.unavailable && !views.unavailable.hidden) return;
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
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("fixfocus.")).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    renderRecent();
    el.results.replaceChildren();
    el.status.textContent = "History cleared.";
  });

  async function start() {
    store.del("apiKey");
    let available = false;
    try {
      const res = await fetch("/api/status");
      const body = await res.json();
      available = body.available === true;
    } catch { available = false; }
    if (!available) { show("unavailable"); return; }
    renderCategories();
    renderRecent();
    show("search");
    const q = new URLSearchParams(location.search).get("q");
    if (q) runSearch(q, { push: false });
    else el.q.focus();
  }
  start();
})();
