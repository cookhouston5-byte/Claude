/* List or grid. Anything other than "grid" stays on the list layout. */
(function (root) {
  "use strict";

  function normalizeView(value) {
    return value === "grid" ? "grid" : "list";
  }

  const api = { normalizeView };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ViewMode = api;
})(typeof window !== "undefined" ? window : globalThis);
