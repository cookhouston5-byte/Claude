/* FixFocus filters: decide which searches and videos are allowed.
 * Pure functions with no DOM, so they can be tested in Node.
 */
(function (root) {
  "use strict";

  // Enough on their own. "fix" by itself is not in this list: song titles use it too.
  const STRONG_FIX_WORDS = [
    "repair", "repairing", "replace", "replacing", "replacement",
    "how to", "how-to", "howto", "diy", "troubleshoot", "troubleshooting", "install", "installing",
    "remove", "removal", "unclog", "clog", "leak", "leaking", "broken", "not working", "won't",
    "wont", "doesn't work", "stopped working", "restore", "restoring", "patch", "seal", "reset",
    "rebuild", "maintenance", "adjust", "tighten", "clean", "cleaning", "solved", "solution",
    "step by step", "tutorial", "guide", "mend", "sew", "glue", "service", "diagnose", "diagnosis",
    "error", "squeak", "rattle", "noise",
  ];

  // Anything with these in the search, title, description, or channel is a distraction.
  // "audio" alone is not listed, so "car audio" can still be a repair.
  const BLOCK_WORDS = [
    "prank", "pranks", "reaction", "reacts", "funny", "funniest", "meme", "memes", "fails",
    "compilation", "music video", "official music video", "official video", "official audio",
    "official lyric video", "lyric video", "lyric", "lyrics", "song", "album", "trailer",
    "movie", "episode", "full episode", "season", "gameplay", "let's play", "lets play",
    "walkthrough", "speedrun", "minecraft", "fortnite", "roblox", "gta", "vlog", "mukbang",
    "asmr", "challenge", "tiktok", "shorts", "#shorts", "highlights", "podcast", "livestream",
    "stream highlights", "unboxing", "haul", "try not to laugh", "satisfying", "storytime",
    "drama", "gossip", "celebrity", "rap", "remix", "dance", "anime", "cartoon", "kids songs",
    "nursery", "rizz", "skibidi", "mrbeast",
  ];

  // Words that show up next to "fix" in songs, not in repair videos.
  const NOT_OBJECTS = new Set([
    "him", "her", "them", "you", "me", "she", "they", "someone", "somebody", "people", "person",
    "man", "woman", "boy", "girl", "heart", "love", "life", "world", "everything", "anything",
    "nothing", "myself", "yourself", "himself", "herself", "this", "that", "these", "those",
    "can", "could", "will", "would", "may", "might", "just", "really", "please", "not",
    "dont", "cannot", "never", "always", "still", "now", "how", "way",
  ]);

  const SHORTS_MAX_SEC = 180;

  // Search phrases that already ask for a fix, so we don't add "how to fix" in front.
  const FIX_START = /^(how (do|can|to|would)|fix|fixing|repair|replace|install|remove|unclog|troubleshoot|diy|why (is|does|won'?t|isn'?t)|what to do)/i;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toRe = (words) => new RegExp("(^|[^a-z0-9])(" + words.map(escapeRe).join("|") + ")(?=$|[^a-z0-9])", "i");
  const STRONG_RE = toRe(STRONG_FIX_WORDS);
  const BLOCK_RE = toRe(BLOCK_WORDS);

  function normalize(s) {
    return String(s || "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  }

  // Is this search about fixing something?
  function checkQuery(raw) {
    const q = normalize(raw);
    if (q.length < 3) return { ok: false, reason: "Tell me what's broken, like \"squeaky door hinge\"." };
    if (!/[a-z]{2,}/i.test(q)) return { ok: false, reason: "Tell me what's broken, in words, like \"squeaky door hinge\"." };
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

  function hasFixPlusObject(text) {
    const t = normalize(text).toLowerCase();
    const patterns = [
      /\b(?:fix|fixing|fixed)\b(?:\s+(?:a|an|the|my|your))?\s+([a-z][a-z0-9-]{2,})/g,
      /\b([a-z][a-z0-9-]{2,})\s+(?:fix|fixed|fixing)\b/g,
    ];
    for (const re of patterns) {
      let match;
      while ((match = re.exec(t))) {
        if (!NOT_OBJECTS.has(match[1])) return true;
      }
    }
    return false;
  }

  function isRepairText(text) {
    return STRONG_RE.test(text) || hasFixPlusObject(text);
  }

  function isShort(title, description, durationSec) {
    if (durationSec != null && durationSec <= SHORTS_MAX_SEC) return true;
    const blob = normalize(title) + " " + normalize(description);
    return /(^|[^a-z0-9])#?shorts(?=$|[^a-z0-9])/i.test(blob);
  }

  function channelBlocked(channelTitle) {
    const c = normalize(channelTitle);
    if (!c) return false;
    if (/vevo/i.test(c)) return true;
    if (/(^|[\s-])topic$/i.test(c)) return true;
    return BLOCK_RE.test(c);
  }

  // Keep only videos that are clearly about fixing something.
  function isFixVideo({ title, description, durationSec, channelTitle }) {
    const t = normalize(title);
    const d = normalize(description);
    if (isShort(t, d, durationSec)) return false;
    if (BLOCK_RE.test(t) || BLOCK_RE.test(d)) return false;
    if (channelBlocked(channelTitle)) return false;
    return isRepairText(t) || isRepairText(d);
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
