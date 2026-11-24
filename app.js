/* Kalmvue: only the latest videos from channels you subscribe to.
 *
 * Runs entirely in the browser. Uses Google sign-in (read-only YouTube scope)
 * and the official YouTube Data API v3. Videos always open on YouTube itself,
 * so creators get their views and YouTube shows its ads as normal.
 */
(() => {
  "use strict";

  const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
  const API = "https://www.googleapis.com/youtube/v3/";
  const VIDEOS_PER_CHANNEL = 8;      // newest N uploads per channel
  const STALE_AFTER_MS = 10 * 60e3;  // auto-refresh if feed is older than 10 min
  const CONCURRENCY = 6;
  const WATCHED_KEEP_DAYS = 365;

  // ---------- storage helpers (never throw) ----------
  const store = {
    get(key, fallback = null, area = localStorage) {
      try { const v = area.getItem("ff." + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value, area = localStorage) {
      try { area.setItem("ff." + key, JSON.stringify(value)); } catch { /* storage full / blocked */ }
    },
    del(key, area = localStorage) {
      try { area.removeItem("ff." + key); } catch { /* ignore */ }
    },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const views = { setup: $("setupView"), signIn: $("signInView"), feed: $("feedView") };
  const el = {
    actions: $("actions"), refreshBtn: $("refreshBtn"), menuBtn: $("menuBtn"), menu: $("menu"),
    signOutBtn: $("signOutBtn"), changeClientBtn: $("changeClientBtn"),
    setupForm: $("setupForm"), clientIdInput: $("clientIdInput"), signInBtn: $("signInBtn"),
    hideWatched: $("hideWatched"), showShorts: $("showShorts"), status: $("status"),
    progress: $("progress"), progressBar: $("progressBar"),
    feed: $("feed"), empty: $("empty"), error: $("error"),
  };

  // ---------- state ----------
  const cfg = window.KALMVUE_CONFIG || {};
  let clientId = (cfg.clientId || "").trim() || store.get("clientId", "");
  let tokenClient = null;
  let pendingToken = null; // {resolve, reject} while the Google popup is open
  let loading = false;

  const prefs = Object.assign({ hideWatched: false, showShorts: false }, store.get("prefs", {}));
  let watched = pruneWatched(store.get("watched", {}));

  function pruneWatched(w) {
    const cutoff = Date.now() - WATCHED_KEEP_DAYS * 864e5;
    for (const id in w) if (w[id] < cutoff) delete w[id];
    return w;
  }

  const feedKey = () => "feed." + (prefs.showShorts ? "all" : "noShorts");

  // ---------- views ----------
  function show(name) {
    for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
    el.actions.hidden = name !== "feed";
  }
  function showError(msg) {
    el.error.textContent = msg || "";
    el.error.hidden = !msg;
  }

  // ---------- Google sign-in (token flow, no server needed) ----------
  function waitForGoogle(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        if (window.google?.accounts?.oauth2) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error("Couldn't load Google sign-in. Check your connection or ad blocker, then reload."));
        setTimeout(poll, 100);
      })();
    });
  }

  function initTokenClient() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        const p = pendingToken; pendingToken = null;
        if (resp.error) { p?.reject(new Error(resp.error_description || resp.error)); return; }
        const token = { access_token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) - 60) * 1000 };
        store.set("token", token, sessionStorage);
        store.set("signedIn", true);
        p?.resolve(token.access_token);
      },
      error_callback: (err) => {
        const p = pendingToken; pendingToken = null;
        const msg = err?.type === "popup_closed" ? "Sign-in window was closed."
          : err?.type === "popup_failed_to_open" ? "Sign-in popup was blocked. Allow popups for this site and try again."
          : "Sign-in failed.";
        p?.reject(new Error(msg));
      },
    });
  }

  function validToken() {
    const t = store.get("token", null, sessionStorage);
    return t && t.expiresAt > Date.now() ? t.access_token : null;
  }

  // Must be called directly from a click handler (before any await) so the popup isn't blocked.
  function getToken({ interactive }) {
    const t = validToken();
    if (t) return Promise.resolve(t);
    if (!interactive || !tokenClient) return Promise.resolve(null);
    if (pendingToken) pendingToken.reject(new Error("Superseded"));
    return new Promise((resolve, reject) => {
      pendingToken = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: store.get("signedIn", false) ? "" : "consent" });
    });
  }

  // ---------- YouTube Data API ----------
  class ApiError extends Error {
    constructor(status, reason, message) { super(message); this.status = status; this.reason = reason; }
  }

  async function api(token, path, params) {
    const url = API + path + "?" + new URLSearchParams(params);
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (res.ok) return res.json();
    let reason = "", message = res.statusText;
    try {
      const body = await res.json();
      reason = body.error?.errors?.[0]?.reason || body.error?.status || "";
      message = body.error?.message || message;
    } catch { /* non-JSON error */ }
    throw new ApiError(res.status, reason, message);
  }

  async function fetchSubscriptions(token) {
    const channels = [];
    let pageToken = "";
    do {
      const data = await api(token, "subscriptions", {
        part: "snippet", mine: "true", maxResults: "50", order: "alphabetical",
        ...(pageToken && { pageToken }),
      });
      for (const item of data.items || []) {
        channels.push({ id: item.snippet.resourceId.channelId, title: item.snippet.title });
      }
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return channels;
  }

  // Each channel has an "uploads" playlist: channel ID "UCxxxx" -> playlist "UUxxxx".
  // YouTube also keeps "UULFxxxx", the same uploads minus Shorts.
  async function fetchChannelVideos(token, channel, includeShorts) {
    const base = channel.id.slice(2);
    const lists = includeShorts ? ["UU" + base] : ["UULF" + base, "UU" + base];
    for (const playlistId of lists) {
      try {
        const data = await api(token, "playlistItems", {
          part: "snippet,contentDetails", playlistId, maxResults: String(VIDEOS_PER_CHANNEL),
        });
        return (data.items || [])
          .filter((it) => it.contentDetails?.videoPublishedAt) // drops private/deleted videos
          .map((it) => ({
            id: it.contentDetails.videoId,
            title: it.snippet.title,
            channelId: channel.id,
            channelTitle: channel.title,
            publishedAt: it.contentDetails.videoPublishedAt,
            thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || "",
          }));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) continue; // playlist missing; try next / skip
        throw e;
      }
    }
    return [];
  }

  async function pool(items, limit, worker, onDone) {
    let i = 0, done = 0;
    const results = new Array(items.length);
    async function run() {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx]);
        onDone(++done, items.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  function friendlyError(e) {
    if (e instanceof ApiError) {
      if (e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded")
        return "YouTube's daily API limit for this app was reached. It resets at midnight Pacific time.";
      if (e.reason === "accessNotConfigured" || e.reason === "SERVICE_DISABLED")
        return "The YouTube Data API v3 isn't enabled in your Google Cloud project yet. See step 2 in SETUP.md.";
      if (e.reason === "subscriptionForbidden")
        return "Your subscriptions are private to apps. Check your YouTube privacy settings.";
      return "YouTube error: " + e.message;
    }
    return e?.message || String(e);
  }

  // ---------- refresh ----------
  function refresh({ interactive }) {
    if (loading) return;
    const tokenPromise = getToken({ interactive }); // synchronous popup call happens here
    loading = true;
    el.refreshBtn.disabled = true;
    showError("");
    setStatus("Checking for new videos…");

    (async () => {
      try {
        let token = await tokenPromise;
        if (!token) { setStatus(statusText()); return; }
        const includeShorts = prefs.showShorts;
        let channels;
        try {
          channels = await fetchSubscriptions(token);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            store.del("token", sessionStorage);
            setStatus("Session expired. Tap Refresh to sign in again.");
            return;
          }
          throw e;
        }

        el.progress.hidden = channels.length === 0;
        el.progressBar.style.width = "0";
        const perChannel = await pool(channels, CONCURRENCY,
          (ch) => fetchChannelVideos(token, ch, includeShorts).catch((e) => {
            if (e instanceof ApiError && (e.status === 401 || e.reason === "quotaExceeded")) throw e;
            console.warn("Skipping channel", ch.title, e);
            return [];
          }),
          (done, total) => { el.progressBar.style.width = (100 * done / total) + "%"; });

        const videos = perChannel.flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
        const feed = { fetchedAt: Date.now(), channelCount: channels.length, videos };
        store.set(feedKey(), feed);
        if (prefs.showShorts === includeShorts) render(feed);
      } catch (e) {
        showError(friendlyError(e));
        setStatus(statusText());
      } finally {
        loading = false;
        el.refreshBtn.disabled = false;
        el.progress.hidden = true;
        if (el.status.textContent === "Checking for new videos…") setStatus(statusText());
      }
    })();
  }

  // ---------- rendering ----------
  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    const units = [["year", 31536e3], ["month", 2592e3], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [name, secs] of units) {
      const n = Math.floor(s / secs);
      if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
    }
    return "just now";
  }

  function statusText() {
    const feed = store.get(feedKey());
    if (!feed) return "";
    return `${feed.channelCount} channels · updated ${timeAgo(new Date(feed.fetchedAt).toISOString())}`;
  }
  function setStatus(text) { el.status.textContent = text; }

  function render(feed = store.get(feedKey())) {
    el.feed.replaceChildren();
    if (!feed) { el.empty.hidden = true; setStatus(loading ? "Checking for new videos…" : ""); return; }

    const list = prefs.hideWatched ? feed.videos.filter((v) => !watched[v.id]) : feed.videos;
    const frag = document.createDocumentFragment();
    for (const v of list) frag.appendChild(videoRow(v));
    el.feed.appendChild(frag);

    el.empty.hidden = list.length > 0;
    el.empty.textContent = feed.videos.length === 0
      ? (feed.channelCount === 0 ? "You're not subscribed to any channels yet. Subscribe on YouTube, then tap Refresh." : "No videos found.")
      : "All caught up. You've watched everything here. 🎉";
    if (!loading) setStatus(statusText());
  }

  function videoRow(v) {
    const li = document.createElement("li");
    li.className = "video" + (watched[v.id] ? " watched" : "");
    li.dataset.id = v.id;

    const a = document.createElement("a");
    a.className = "link";
    a.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(v.id);
    a.target = "_blank";
    a.rel = "noopener";
    a.addEventListener("click", () => setWatched(v.id, true, li));

    const img = document.createElement("img");
    img.className = "thumb";
    img.loading = "lazy";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    if (v.thumb) img.src = v.thumb;

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = v.title;
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = `${v.channelTitle} · ${timeAgo(v.publishedAt)}`;
    meta.append(title, sub);
    a.append(img, meta);

    const check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.textContent = "✓";
    const label = () => (watched[v.id] ? "Mark as not watched" : "Mark as watched");
    check.title = label();
    check.setAttribute("aria-label", label());
    check.addEventListener("click", () => {
      setWatched(v.id, !watched[v.id], li);
      check.title = label();
      check.setAttribute("aria-label", label());
    });

    li.append(a, check);
    return li;
  }

  function setWatched(id, on, li) {
    if (on) watched[id] = Date.now(); else delete watched[id];
    store.set("watched", watched);
    li.classList.toggle("watched", on);
    if (on && prefs.hideWatched) {
      // Let the click open YouTube first, then remove the row.
      setTimeout(() => render(), 400);
    }
  }

  // ---------- events ----------
  el.setupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = el.clientIdInput.value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(v)) {
      showError("That doesn't look like a Client ID. It should end in .apps.googleusercontent.com");
      return;
    }
    store.set("clientId", v);
    location.reload();
  });

  el.signInBtn.addEventListener("click", () => {
    showError("");
    getToken({ interactive: true })
      .then(() => { show("feed"); render(); refresh({ interactive: false }); })
      .catch((e) => showError(e.message));
  });

  el.refreshBtn.addEventListener("click", () => refresh({ interactive: true }));

  el.hideWatched.checked = prefs.hideWatched;
  el.showShorts.checked = prefs.showShorts;
  el.hideWatched.addEventListener("change", () => {
    prefs.hideWatched = el.hideWatched.checked; store.set("prefs", prefs); render();
  });
  el.showShorts.addEventListener("change", () => {
    prefs.showShorts = el.showShorts.checked; store.set("prefs", prefs);
    render();
    const feed = store.get(feedKey());
    if (!feed || Date.now() - feed.fetchedAt > STALE_AFTER_MS) refresh({ interactive: true });
  });

  el.menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.menu.hidden = !el.menu.hidden;
    el.menuBtn.setAttribute("aria-expanded", String(!el.menu.hidden));
  });
  document.addEventListener("click", () => { el.menu.hidden = true; el.menuBtn.setAttribute("aria-expanded", "false"); });

  el.signOutBtn.addEventListener("click", () => {
    const t = validToken();
    if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t, () => {});
    store.del("token", sessionStorage);
    store.del("signedIn");
    store.del("feed.all");
    store.del("feed.noShorts");
    el.feed.replaceChildren();
    show("signIn");
  });

  el.changeClientBtn.addEventListener("click", () => {
    if (cfg.clientId) { showError("The Client ID is set in config.js. Edit that file to change it."); return; }
    store.del("clientId");
    location.reload();
  });

  // Refresh the "updated X ago" text, and auto-refresh when you come back to the tab.
  setInterval(() => { if (!loading && !views.feed.hidden) setStatus(statusText()); }, 60e3);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || views.feed.hidden) return;
    const feed = store.get(feedKey());
    if (validToken() && (!feed || Date.now() - feed.fetchedAt > STALE_AFTER_MS)) refresh({ interactive: false });
  });

  // ---------- start ----------
  async function start() {
    if (!clientId) { show("setup"); return; }
    try {
      await waitForGoogle();
      initTokenClient();
    } catch (e) {
      showError(e.message);
    }
    if (!store.get("signedIn", false)) { show("signIn"); return; }

    show("feed");
    render();
    const feed = store.get(feedKey());
    if (validToken()) {
      if (!feed || Date.now() - feed.fetchedAt > STALE_AFTER_MS) refresh({ interactive: false });
    } else {
      setStatus((feed ? statusText() + " · " : "") + "tap Refresh for new videos");
    }
  }

  start();
})();
