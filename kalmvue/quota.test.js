const assert = require("assert");
const Q = require("./quota.js");

const hour = 60 * 60 * 1000;
const now = 1_000_000_000_000;
const channels = [{ id: "UC1" }, { id: "UC2" }, { id: "UC3" }];
const cache = {
  UC1: { fetchedAt: now - hour },
  UC2: { fetchedAt: now - 4 * hour },
};

assert.deepStrictEqual(
  Q.channelsToRefresh(channels, cache, now, { force: false, windowMs: Q.VIDEO_REFRESH_MS }),
  ["UC2", "UC3"]
);
assert.deepStrictEqual(
  Q.channelsToRefresh(channels, cache, now, { force: true, windowMs: Q.VIDEO_REFRESH_MS }),
  ["UC1", "UC2", "UC3"]
);
assert.equal(Q.VIDEO_REFRESH_MS, 3 * hour);
assert.equal(Q.SUBS_RECHECK_MS, 30 * 60 * 1000);

assert.equal(Q.isShortVideo({ title: "Quick tip", durationSec: 180 }), true);
assert.equal(Q.isShortVideo({ title: "Full repair", durationSec: 181 }), false);
assert.equal(Q.isShortVideo({ title: "Replace a washer #shorts", durationSec: 400 }), true);
assert.equal(Q.isShortVideo({ title: "Replace a washer", description: "see #shorts", durationSec: null }), true);
assert.equal(Q.isShortVideo({ title: "Replace a washer", description: "a long guide", durationSec: null }), false);
assert.equal(Q.parseDuration("PT3M"), 180);
assert.equal(Q.parseDuration("PT3M1S"), 181);

console.log("Kalmvue quota tests passed");
