const assert = require("assert");
const { normalizeView } = require("./view-mode.js");

assert.strictEqual(normalizeView(undefined), "list");
assert.strictEqual(normalizeView(null), "list");
assert.strictEqual(normalizeView(""), "list");
assert.strictEqual(normalizeView("list"), "list");
assert.strictEqual(normalizeView("grid"), "grid");
assert.strictEqual(normalizeView("GRID"), "list");
assert.strictEqual(normalizeView("cards"), "list");
console.log("FixFocus view mode tests passed");
