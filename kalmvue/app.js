/* Kalmvue: only the latest videos from channels you subscribe to.
 *
 * Runs in the browser. Uses Google sign-in (read-only YouTube scope)
 * and the official YouTube Data API v3. Videos play here in YouTube's
 * privacy-enhanced player. Creators still get the view.
 * The OAuth Client ID comes from config.js. It is not a secret.
 */
(() => {
  "use strict";

  const Q = window.KalmQuota;
  const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
  const API = "https://www.googleapis.com/youtube/v3/";
  const VIDEOS_PER_CHANNEL = 8;
  const CONCURRENCY = 6;
  const WATCHED_KEEP_DAYS = 365;
  const CHECKING = "Checking for new videos...";

  const store = {
    get(key, fallback = null, area = localStorage) {
      try { const v = area.getItem("ff." + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value, area = localStorage) {
      try { area.setItem("ff." + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
    },
    del(key, area = localStorage) {
      try { area.removeItem("ff." + key); } catch { /* ignore */ }
    },
  };

  const $ = (id) => document.getElementById(id);
  const views = { soon: $("soonView"), signIn: $("signInView"), feed: $("feedView"), player: $("playerView") };
  const el = {
    actions: $("actions"), refreshBtn: $("refreshBtn"), menuBtn: $("menuBtn"), menu: $("menu"),
    signOutBtn: $("signOutBtn"), signInBtn: $("signInBtn"),
    hideWatched: $("hideWatched"), showShorts: $("showShorts"), status: $("status"),
    progress: $("progress"), progressBar: $("progressBar"),
    feed: $("feed"), empty: $("empty"), error: $("error"),
    heroSlot: $("heroSlot"), feedHeading: $("feedHeading"),
    creatorList: $("creatorList"), creatorCount: $("creatorCount"), moreCreators: $("moreCreators"),
    sidebar: $("sidebar"), sidebarOpen: $("sidebarOpen"), sidebarClose: $("sidebarClose"),
    sidebarBackdrop: $("sidebarBackdrop"), signOutSide: $("signOutSide"),
    listViewBtn: $("listViewBtn"), gridViewBtn: $("gridViewBtn"),
    backBtn: $("backBtn"), playerBox: $("playerBox"), playerTitle: $("playerTitle"),
    playerSub: $("playerSub"), ytLink: $("ytLink"),
  };

  const cfg = window.KALMVUE_CONFIG || {};
  const clientId = String(cfg.clientId || "").trim();
  let tokenClient = null;
  let pendingToken = null;
  let loading = false;

  const prefs = Object.assign({ hideWatched: false, showShorts: false }, store.get("prefs", {}));
  let watched = pruneWatched(store.get("watched", {}));
  let viewMode = window.ViewMode.normalizeView(store.get("viewMode", "list"));
  let creatorFilter = "";
  let creatorsExpanded = false;

  function applyView(next) {
    viewMode = window.ViewMode.normalizeView(next);
    store.set("viewMode", viewMode);
    el.feed.classList.toggle("grid", viewMode === "grid");
    document.body.classList.toggle("view-grid", viewMode === "grid");
    el.listViewBtn.setAttribute("aria-pressed", String(viewMode === "list"));
    el.gridViewBtn.setAttribute("aria-pressed", String(viewMode === "grid"));
    if (views.feed && !views.feed.hidden) render();
  }

  function pruneWatched(w) {
    const cutoff = Date.now() - WATCHED_KEEP_DAYS * 864e5;
    for (const id in w) if (w[id] < cutoff) delete w[id];
    return w;
  }

  const feedKey = () => "feed." + (prefs.showShorts ? "all" : "noShorts");

  function show(name) {
    for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
    el.actions.hidden = name !== "feed" && name !== "player";
    if (name !== "player") el.playerBox.replaceChildren();
  }
  function showError(msg) {
    el.error.textContent = msg || "";
    el.error.hidden = !msg;
  }

  function loadGoogle(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Google sign-in didn't load. Check your connection, then reload the page."));
      }, timeoutMs);
      script.onload = () => {
        const start = Date.now();
        (function poll() {
          if (settled) return;
          if (window.google?.accounts?.oauth2) {
            settled = true;
            clearTimeout(timer);
            resolve();
            return;
          }
          if (Date.now() - start > timeoutMs) return;
          setTimeout(poll, 50);
        })();
      };
      script.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("Google sign-in didn't load. Check your connection, then reload the page."));
      };
      document.head.appendChild(script);
    });
  }

  function initTokenClient() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        const p = pendingToken; pendingToken = null;
        if (resp.error) {
          console.error("Google sign-in", resp.error, resp.error_description || "");
          const msg = resp.error === "access_denied"
            ? "Sign-in was cancelled, or this Google account isn't allowed to use Kalmvue yet."
            : "Sign-in didn't finish. Please try again.";
          p?.reject(new Error(msg));
          return;
        }
        const token = { access_token: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) - 60) * 1000 };
        store.set("token", token, sessionStorage);
        store.set("signedIn", true);
        p?.resolve(token.access_token);
      },
      error_callback: (err) => {
        const p = pendingToken; pendingToken = null;
        const msg = err?.type === "popup_closed" ? "Sign-in window was closed."
          : err?.type === "popup_failed_to_open" ? "The sign-in popup was blocked. Allow popups for this site and try again."
          : "Sign-in didn't finish. Please try again.";
        p?.reject(new Error(msg));
      },
    });
  }

  function validToken() {
    const t = store.get("token", null, sessionStorage);
    return t && t.expiresAt > Date.now() ? t.access_token : null;
  }

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
        const thumbs = item.snippet.thumbnails || {};
        channels.push({
          id: item.snippet.resourceId.channelId,
          title: item.snippet.title,
          thumb: thumbs.default?.url || thumbs.medium?.url || "",
        });
      }
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return channels;
  }

  function mapPlaylistItems(items, channel) {
    return (items || [])
      .filter((it) => it.contentDetails?.videoPublishedAt && /^[A-Za-z0-9_-]{11}$/.test(it.contentDetails.videoId || ""))
      .map((it) => ({
        id: it.contentDetails.videoId,
        title: it.snippet.title,
        channelId: channel.id,
            channelTitle: channel.title,
            channelThumb: channel.thumb || "",
            publishedAt: it.contentDetails.videoPublishedAt,
        thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || "",
      }));
  }

  // The full uploads playlist includes Shorts. Drop them by length and by #shorts.
  async function withoutShorts(token, videos) {
    const titled = videos.filter((video) => !Q.isShortVideo({ title: video.title, durationSec: null }));
    if (!titled.length) return [];
    try {
      const data = await api(token, "videos", {
        part: "contentDetails,snippet",
        id: titled.map((video) => video.id).join(","),
        maxResults: "50",
      });
      const byId = new Map((data.items || []).map((item) => [item.id, item]));
      return titled.filter((video) => {
        const item = byId.get(video.id);
        return !Q.isShortVideo({
          title: item?.snippet?.title || video.title,
          description: item?.snippet?.description || "",
          durationSec: Q.parseDuration(item?.contentDetails?.duration),
        });
      });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded")) throw e;
      return titled;
    }
  }

  async function fetchChannelVideos(token, channel, includeShorts) {
    const base = channel.id.slice(2);
    const lists = includeShorts ? ["UU" + base] : ["UULF" + base, "UU" + base];
    for (const playlistId of lists) {
      try {
        const data = await api(token, "playlistItems", {
          part: "snippet,contentDetails", playlistId, maxResults: String(VIDEOS_PER_CHANNEL),
        });
        let videos = mapPlaylistItems(data.items, channel);
        if (!includeShorts && playlistId === "UU" + base) videos = await withoutShorts(token, videos);
        return videos;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) continue;
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
      console.error("YouTube API", e.status, e.reason || "", e.message || "");
      if (e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded")
        return "YouTube's daily limit for Kalmvue was reached. It resets at midnight Pacific time. Videos already loaded stay on the page.";
      if (e.status === 401)
        return "Your Google sign-in expired. Tap Refresh to sign in again.";
      if (e.reason === "subscriptionForbidden")
        return "YouTube wouldn't share your subscriptions. Check that you're signed in with the right Google account, then try again.";
      return "Kalmvue couldn't refresh your videos. Please try again in a few minutes.";
    }
    console.error(e);
    if (/failed to fetch|networkerror|load failed/i.test(e?.message || ""))
      return "Kalmvue couldn't reach YouTube. Check your connection and try again.";
    return e?.message || "Something went wrong. Please try again.";
  }

  // Background checks are every 3 hours. Coming back to the tab re-reads
  // subscriptions at most every 30 minutes. Refresh loads every channel now.
  let lastSubsCheck = 0;

  function refresh({ interactive, videos }) {
    if (loading) return;
    const tokenPromise = getToken({ interactive });
    loading = true;
    el.refreshBtn.disabled = true;
    showError("");
    setStatus(CHECKING);

    (async () => {
      try {
        let token = await tokenPromise;
        if (!token) {
          if (interactive) showError("Google sign-in didn't load. Check your connection, then reload the page.");
          setStatus(statusText());
          return;
        }
        const includeShorts = prefs.showShorts;
        let channels;
        try {
          channels = await fetchSubscriptions(token);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            store.del("token", sessionStorage);
            const msg = "Your Google sign-in expired. Tap Refresh to sign in again.";
            setStatus(msg);
            showError(msg);
            return;
          }
          throw e;
        }
        lastSubsCheck = Date.now();

        const channelIds = channels.map((ch) => ch.id).sort();
        const existing = store.get(feedKey());
        const cached = existing?.byChannel || {};
        const fetchIds = new Set(Q.channelsToRefresh(channels, cached, Date.now(), {
          force: videos === "always",
          windowMs: Q.VIDEO_REFRESH_MS,
        }));
        const needed = channels.filter((ch) => fetchIds.has(ch.id));

        el.progress.hidden = needed.length === 0;
        el.progressBar.style.width = "0";
        const fetched = await pool(needed, CONCURRENCY,
          (ch) => fetchChannelVideos(token, ch, includeShorts).catch((e) => {
            if (e instanceof ApiError && (e.status === 401 || e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded")) throw e;
            console.warn("Skipping channel", ch.title, e);
            return [];
          }),
          (done, total) => { el.progressBar.style.width = (100 * done / total) + "%"; });

        const fetchedAtNow = Date.now();
        const byId = new Map(needed.map((ch, index) => [ch.id, fetched[index] || []]));
        const byChannel = {};
        const videoList = [];
        for (const ch of channels) {
          if (fetchIds.has(ch.id)) {
            const list = byId.get(ch.id) || [];
            byChannel[ch.id] = { fetchedAt: fetchedAtNow, latestVideoId: list[0]?.id || "", videos: list };
          } else if (cached[ch.id]) {
            byChannel[ch.id] = cached[ch.id];
          }
          videoList.push(...(byChannel[ch.id]?.videos || []));
        }
        videoList.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
        const times = channels.map((ch) => byChannel[ch.id]?.fetchedAt).filter((t) => typeof t === "number");
        const feed = {
          fetchedAt: times.length ? Math.min(...times) : fetchedAtNow,
          channelCount: channels.length,
          channelIds,
          byChannel,
          videos: videoList,
        };
        store.set(feedKey(), feed);
        if (prefs.showShorts === includeShorts) render(feed);
      } catch (e) {
        showError(friendlyError(e));
        setStatus(statusText());
      } finally {
        loading = false;
        el.refreshBtn.disabled = false;
        el.progress.hidden = true;
        if (el.status.textContent === CHECKING) setStatus(statusText());
      }
    })();
  }

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
    const base = `${feed.channelCount} channels · updated ${timeAgo(new Date(feed.fetchedAt).toISOString())}`;
    return validToken() ? base : base + " · Tap Refresh for new videos";
  }
  function setStatus(text) { el.status.textContent = text; }

  function render(feed = store.get(feedKey())) {
    el.feed.replaceChildren();
    if (!feed) { el.empty.hidden = true; setStatus(loading ? CHECKING : ""); return; }

    let list = prefs.hideWatched ? feed.videos.filter((v) => !watched[v.id]) : feed.videos.slice();
    if (creatorFilter) list = list.filter((v) => v.channelId === creatorFilter);
    const showHero = viewMode === "grid" && list.length > 0;
    el.heroSlot.replaceChildren();
    el.feedHeading.hidden = !showHero;
    if (showHero) {
      const hero = videoRow(list[0]);
      hero.classList.add("hero-card");
      el.heroSlot.append(hero);
    }
    const frag = document.createDocumentFragment();
    for (const v of (showHero ? list.slice(1) : list)) frag.appendChild(videoRow(v));
    el.feed.appendChild(frag);
    renderCreators(feed.videos);

    el.empty.hidden = list.length > 0;
    el.empty.textContent = feed.videos.length === 0
      ? (feed.channelCount === 0
        ? "You're not subscribed to any channels yet. Subscribe on YouTube, then tap Refresh."
        : "No recent videos showed up. Tap Refresh to try again.")
      : "All caught up. You've watched everything in this list.";
    if (!loading) setStatus(statusText());
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

  function videoRow(v) {
    const li = document.createElement("li");
    li.className = "video" + (watched[v.id] ? " watched" : "");
    li.dataset.id = v.id;

    const watchUrl = "https://www.youtube.com/watch?v=" + encodeURIComponent(v.id);
    const a = document.createElement("a");
    a.className = "link";
    a.href = watchUrl;
    a.rel = "noopener";
    let held = null;
    a.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      held = setTimeout(() => setWatched(v.id, true, li), 550);
    });
    const clearHeld = () => { if (held) { clearTimeout(held); held = null; } };
    a.addEventListener("pointerup", clearHeld);
    a.addEventListener("pointerleave", clearHeld);
    a.addEventListener("pointercancel", clearHeld);
    a.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      setWatched(v.id, true, li);
      window.open(watchUrl, "_blank", "noopener");
    });
    a.addEventListener("click", (e) => {
      setWatched(v.id, true, li);
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      openPlayer(v);
    });

    const wrap = document.createElement("span");
    wrap.className = "thumbwrap";
    const img = document.createElement("img");
    img.className = "thumb";
    img.loading = "lazy";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    if (v.thumb) img.src = v.thumb;
    const play = document.createElement("span");
    play.className = "play";
    play.setAttribute("aria-hidden", "true");
    wrap.append(img, play);

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = v.title;
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.append(avatarEl(v.channelTitle, v.channelThumb), document.createTextNode(`${v.channelTitle} · ${timeAgo(v.publishedAt)}`));
    meta.append(title, sub);
    a.append(wrap, meta);

    const check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.appendChild(checkIcon());
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

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).slice(0, 2);
    const letters = parts.map((part) => part[0] || "").join("").toUpperCase();
    return letters || "?";
  }

  function avatarEl(name, thumb) {
    const span = document.createElement("span");
    span.className = "avatar";
    if (thumb) {
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = thumb;
      span.append(img);
    } else {
      span.textContent = initials(name);
    }
    return span;
  }

  function renderCreators(videos) {
    const byId = new Map();
    for (const video of videos || []) {
      if (!video.channelId) continue;
      if (!byId.has(video.channelId)) {
        byId.set(video.channelId, {
          id: video.channelId,
          title: video.channelTitle,
          thumb: video.channelThumb || "",
          hasNew: false,
        });
      }
      if (!watched[video.id]) byId.get(video.channelId).hasNew = true;
    }
    const creators = [...byId.values()];
    const noun = creators.length === 1 ? "Creator" : "Creators";
    el.creatorCount.textContent = creators.length ? `Subscribed (${creators.length} ${noun})` : "Subscribed";
    const shown = creatorsExpanded ? creators : creators.slice(0, 8);
    const all = document.createElement("button");
    all.type = "button";
    all.className = "creator";
    all.setAttribute("aria-pressed", String(!creatorFilter));
    const allName = document.createElement("span");
    allName.className = "name";
    allName.textContent = "Subscribed";
    all.append(avatarEl("Subscribed", ""), allName);
    all.addEventListener("click", () => { creatorFilter = ""; render(); closeSidebar(); });
    const frag = document.createDocumentFragment();
    frag.append(all);
    for (const creator of shown) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "creator";
      btn.setAttribute("aria-pressed", String(creatorFilter === creator.id));
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = creator.title;
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.hidden = !creator.hasNew;
      dot.setAttribute("aria-label", creator.hasNew ? "New videos" : "");
      btn.append(avatarEl(creator.title, creator.thumb), name, dot);
      btn.addEventListener("click", () => { creatorFilter = creator.id; render(); closeSidebar(); });
      frag.append(btn);
    }
    el.creatorList.replaceChildren(frag);
    el.moreCreators.hidden = creators.length <= 8;
    el.moreCreators.textContent = creatorsExpanded ? "Fewer" : "More";
  }

  function openSidebar() {
    el.sidebar.classList.add("open");
    el.sidebarBackdrop.hidden = false;
    el.sidebarOpen.setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    el.sidebar.classList.remove("open");
    el.sidebarBackdrop.hidden = true;
    el.sidebarOpen.setAttribute("aria-expanded", "false");
  }

  function setWatched(id, on, li) {
    if (on) watched[id] = Date.now(); else delete watched[id];
    store.set("watched", watched);
    if (li) li.classList.toggle("watched", on);
    if (on && prefs.hideWatched && views.player.hidden) setTimeout(() => render(), 400);
  }

  function openPlayer(v) {
    const frame = document.createElement("iframe");
    frame.title = v.title;
    frame.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(v.id) +
      "?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&autoplay=1";
    el.playerBox.replaceChildren(frame);
    el.playerTitle.textContent = v.title;
    el.playerSub.textContent = `${v.channelTitle} · ${timeAgo(v.publishedAt)}`;
    el.ytLink.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(v.id);
    show("player");
    window.scrollTo(0, 0);
  }

  el.signInBtn.addEventListener("click", () => {
    showError("");
    if (!tokenClient) {
      showError("Google sign-in didn't load. Check your connection, then reload the page.");
      return;
    }
    getToken({ interactive: true })
      .then((token) => {
        if (!token) {
          showError("Google sign-in didn't load. Check your connection, then reload the page.");
          return;
        }
        show("feed");
        render();
        refresh({ interactive: false, videos: "always" });
      })
      .catch((e) => showError(e.message));
  });

  el.refreshBtn.addEventListener("click", () => refresh({ interactive: true, videos: "always" }));
  el.listViewBtn.addEventListener("click", () => applyView("list"));
  el.gridViewBtn.addEventListener("click", () => applyView("grid"));

  el.hideWatched.checked = prefs.hideWatched;
  el.showShorts.checked = prefs.showShorts;
  el.hideWatched.addEventListener("change", () => {
    prefs.hideWatched = el.hideWatched.checked; store.set("prefs", prefs); render();
  });
  el.showShorts.addEventListener("change", () => {
    prefs.showShorts = el.showShorts.checked; store.set("prefs", prefs);
    render();
    const feed = store.get(feedKey());
    if (!feed || Date.now() - feed.fetchedAt > Q.VIDEO_REFRESH_MS) refresh({ interactive: true, videos: "if-needed" });
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
    store.del("watched");
    store.del("prefs");
    store.del("clientId");
    watched = {};
    prefs.hideWatched = false;
    prefs.showShorts = false;
    el.hideWatched.checked = false;
    el.showShorts.checked = false;
    el.feed.replaceChildren();
    el.heroSlot.replaceChildren();
    creatorFilter = "";
    showError("");
    show("signIn");
    closeSidebar();
  });
  el.signOutSide.addEventListener("click", () => el.signOutBtn.click());
  el.moreCreators.addEventListener("click", () => {
    creatorsExpanded = !creatorsExpanded;
    const feed = store.get(feedKey());
    if (feed) renderCreators(feed.videos);
  });
  el.sidebarOpen.addEventListener("click", (e) => { e.stopPropagation(); openSidebar(); });
  el.sidebarClose.addEventListener("click", closeSidebar);
  el.sidebarBackdrop.addEventListener("click", closeSidebar);

  function refreshInBackground() {
    if (loading || (views.feed.hidden && views.player.hidden) || document.visibilityState !== "visible" || !validToken()) return;
    const feed = store.get(feedKey());
    const stale = !feed || Date.now() - feed.fetchedAt > Q.VIDEO_REFRESH_MS;
    const subsDue = Date.now() - lastSubsCheck > Q.SUBS_RECHECK_MS;
    if (stale || subsDue) refresh({ interactive: false, videos: "if-needed" });
  }

  setInterval(() => {
    if (loading || views.feed.hidden) return;
    setStatus(statusText());
    const feed = store.get(feedKey());
    if (!feed || Date.now() - feed.fetchedAt > Q.VIDEO_REFRESH_MS) refreshInBackground();
  }, 60e3);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshInBackground();
  });
  el.backBtn.addEventListener("click", () => { show("feed"); render(); });

  async function start() {
    // The old page let a visitor save a Client ID in this browser. That is gone.
    store.del("clientId");
    applyView(viewMode);
    if (!clientId) { show("soon"); return; }

    const signedIn = store.get("signedIn", false);
    if (signedIn) {
      show("feed");
      render();
    } else {
      show("signIn");
    }

    try {
      await loadGoogle();
      initTokenClient();
    } catch (e) {
      showError(e.message);
      return;
    }

    if (!signedIn) return;
    const feed = store.get(feedKey());
    if (validToken()) refreshInBackground();
    else if (feed) setStatus(statusText());
  }

  start();
})();
