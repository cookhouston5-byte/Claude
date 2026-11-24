/* Decisions that keep Kalmvue inside the shared YouTube quota.
 * Pure functions so they can be tested without a browser.
 */
(function (root) {
  "use strict";

  const VIDEO_REFRESH_MS = 3 * 60 * 60 * 1000;
  const SUBS_RECHECK_MS = 30 * 60 * 1000;
  const SHORTS_MAX_SEC = 180;

  // Channels fetched inside the window are skipped. Comparing the latest
  // video id would spend the same playlistItems unit as loading the page,
  // so the window is what actually saves quota. A manual refresh sets force.
  function channelsToRefresh(channels, cachedById, now, options) {
    const force = !!(options && options.force);
    const windowMs = options && options.windowMs != null ? options.windowMs : VIDEO_REFRESH_MS;
    const list = Array.isArray(channels) ? channels : [];
    if (force) return list.map((channel) => channel.id);
    return list.filter((channel) => {
      const prev = cachedById && cachedById[channel.id];
      if (!prev || typeof prev.fetchedAt !== "number") return true;
      return now - prev.fetchedAt >= windowMs;
    }).map((channel) => channel.id);
  }

  function parseDuration(iso) {
    const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
    if (!match) return null;
    return ((+match[1] || 0) * 86400) + ((+match[2] || 0) * 3600) + ((+match[3] || 0) * 60) + (+match[4] || 0);
  }

  function isShortVideo({ title, description, durationSec }) {
    if (durationSec != null && durationSec <= SHORTS_MAX_SEC) return true;
    const blob = String(title || "") + " " + String(description || "");
    return /(^|[^a-z0-9])#shorts(?=$|[^a-z0-9])/i.test(blob);
  }

  const api = {
    VIDEO_REFRESH_MS,
    SUBS_RECHECK_MS,
    SHORTS_MAX_SEC,
    channelsToRefresh,
    parseDuration,
    isShortVideo,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KalmQuota = api;
})(typeof window !== "undefined" ? window : globalThis);
