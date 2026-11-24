/* FixFocus filters: decide which searches and videos are allowed.
 * Pure functions with no DOM, so they can be tested in Node.
 */
(function (root) {
  "use strict";

  // A video's title (or description) must contain one of these to count as a fix video.
  const FIX_WORDS = [
    "fix", "fixing", "fixed", "repair", "repairing", "replace", "replacing", "replacement",
    "how to", "how-to", "howto", "diy", "troubleshoot", "troubleshooting", "install", "installing",
    "remove", "removal", "unclog", "clog", "leak", "leaking", "broken", "not working", "won't",
    "wont", "doesn't work", "stopped working", "restore", "restoring", "patch", "seal", "reset",
    "rebuild", "maintenance", "adjust", "tighten", "clean", "cleaning", "solved", "solution",
    "step by step", "tutorial", "guide", "mend", "sew", "glue", "service", "diagnose", "diagnosis",
    "error", "squeak", "rattle", "noise",
  ];

  // Anything with these in the search or the title is a distraction, not a fix.
  const BLOCK_WORDS = [
    "prank", "pranks", "reaction", "reacts", "funny", "funniest", "meme", "memes", "fails",
    "compilation", "music video", "official video", "lyrics", "song", "album", "trailer",
    "movie", "episode", "full episode", "season", "gameplay", "let's play", "lets play",
    "walkthrough", "speedrun", "minecraft", "fortnite", "roblox", "gta", "vlog", "mukbang",
    "asmr", "challenge", "tiktok", "shorts", "#shorts", "highlights", "podcast", "livestream",
    "stream highlights", "unboxing", "haul", "try not to laugh", "satisfying", "storytime",
    "drama", "gossip", "celebrity", "rap", "remix", "dance", "anime", "cartoon", "kids songs",
    "nursery", "rizz", "skibidi", "mrbeast",
  ];

  // Search phrases that already ask for a fix, so we don't add "how to fix" in front.
  const FIX_START = /^(how (do|can|to|would)|fix|fixing|repair|replace|install|remove|unclog|troubleshoot|diy|why (is|does|won'?t|isn'?t)|what to do)/i;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toRe = (words) => new RegExp("(^|[^a-z0-9])(" + words.map(escapeRe).join("|") + ")(?=$|[^a-z0-9])", "i");
  const FIX_RE = toRe(FIX_WORDS);
  const BLOCK_RE = toRe(BLOCK_WORDS);

  function normalize(s) {
    return String(s || "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  }

  // Is this search about fixing something?
  function checkQuery(raw) {
    const q = normalize(raw);
    if (q.length < 3) return { ok: false, reason: "Tell me what's broken, like \"squeaky door hinge\"." };
    const m = q.match(BLOCK_RE);
    if (m) return { ok: false, reason: `FixFocus only finds repair videos. "${m[2]}" sounds like a distraction. What needs fixing?` };
    if (/^(https?:\/\/|www\.)/i.test(q)) return { ok: false, reason: "Type what's broken instead of a link." };
    return { ok: true };
  }

  // Turn "leaky faucet" into "how to fix leaky faucet".
  function buildQuery(raw) {
    const q = normalize(raw);
    return FIX_START.test(q) ? q : "how to fix " + q;
  }

  // Keep only videos that are clearly about fixing something.
  function isFixVideo({ title, description, durationSec }) {
    const t = normalize(title);
    if (BLOCK_RE.test(t)) return false;
    if (durationSec != null && durationSec <= 60) return false; // Shorts
    return FIX_RE.test(t) || FIX_RE.test(normalize(description));
  }

  // "PT1H2M3S" -> 3723
  function parseDuration(iso) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
    if (!m) return null;
    return ((+m[1] || 0) * 86400) + ((+m[2] || 0) * 3600) + ((+m[3] || 0) * 60) + (+m[4] || 0);
  }

  const api = { checkQuery, buildQuery, isFixVideo, parseDuration };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FixFilter = api;
})(typeof window !== "undefined" ? window : globalThis);
