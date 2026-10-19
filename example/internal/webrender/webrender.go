// Package webrender wires the example's renderx pipeline to the TanStack
// Router SSR adapter (@ploykit/runtime/router-tanstack).
//
// The TanStack PoC (D:\code\_tmp\tanstack-poc, VERDICT.md 2026-10-19 — verdict
// GO with conditions) identified two engine-side affordances the QuickJS
// sandbox needs before a TanStack SSR bundle evaluates:
//
//  1. A prelude addendum: URLSearchParams (router-core qss.js constructs one
//     during every router construction) and a construct-only AbortController
//     (matchRoutesInternal builds one per match; only the never-running async
//     load pipeline touches .signal/.abort). The canonical source of the shim
//     text is the TS constant PRELUDE_SHIMS in packages/runtime — this Go
//     mirror must be kept textually identical. The split/join ('+'-as-space)
//     form is deliberate: it contains no backslash, so a Go raw-string literal
//     and a JS template literal can carry byte-identical text (a /\\+/g regex
//     literal would need different escaping per language).
//
//  2. An esbuild alias pinning @tanstack/router-core/isServer to the server
//     variant (statically isServer=true). With the default client variant,
//     `isServer ?? this.isServer` short-circuits on non-nullish false and
//     evaluates `window?.origin` → ReferenceError in the sandbox (window is
//     deliberately never defined). The server variant also makes Matches skip
//     the Transitioner (which would call the forbidden async load()).
//
// FRAMEWORK NOTE: today these live consumer-side because platform/renderx has
// no first-class TanStack affordance (PoolOptions.Prelude accepts an override;
// BuildOptions.Alias accepts extra aliases — both composition points exist).
// If a second product adopts TanStack SSR, promote both into renderx
// (e.g. renderx.TanstackPreludeAddendum + append-TanstackAliases helper) and
// have packages/runtime reference that copy instead of mirroring.
package webrender

import (
	"os"
	"path/filepath"

	"github.com/haozing/ploykit/platform/renderx"
)

// TanstackPreludeAddendum is the Go raw-string mirror of PRELUDE_SHIMS
// (@ploykit/runtime/router-tanstack). Textually identical modulo the leading
// newline; keep the two in lockstep (see package comment).
const TanstackPreludeAddendum = `
// ---- tanstack-router addendum (@ploykit/runtime/router-tanstack, PoC 2026-10-19) ----
// URLSearchParams: router-core qss.js decode/encode runs at every router
// construction (parseLocation). QuickJS has no Web Encoding API.
if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = function URLSearchParams(init) {
    var self = this;
    self._m = new Map();
    function appendRaw(k, v) { var a = self._m.get(k) || []; a.push(String(v)); self._m.set(k, a); }
    self._appendRaw = appendRaw;
    if (typeof init === 'string') {
      var s = init.charAt(0) === '?' ? init.slice(1) : init;
      if (s) {
        s.split('&').forEach(function (pair) {
          if (!pair) return;
          var parts = pair.split('=');
          // '+' as space via split/join (NOT a regex literal): the Go render
          // pipeline mirrors this string as a raw-string literal, where a
          // backslash would double up and silently change the regex semantics.
          var k = decodeURIComponent((parts[0] || '').split('+').join(' '));
          var v = decodeURIComponent((parts[1] || '').split('+').join(' '));
          appendRaw(k, v);
        });
      }
    } else if (init && typeof init === 'object') {
      Object.keys(init).forEach(function (k) { appendRaw(k, init[k]); });
    }
  };
  globalThis.URLSearchParams.prototype.set = function (k, v) { this._m.set(k, [String(v)]); };
  globalThis.URLSearchParams.prototype.append = function (k, v) { this._appendRaw(k, v); };
  globalThis.URLSearchParams.prototype.entries = function () {
    // plain array: iterable in QuickJS without custom Symbol.iterator plumbing
    var out = [];
    this._m.forEach(function (vs, k) { vs.forEach(function (v) { out.push([k, v]); }); });
    return out;
  };
  globalThis.URLSearchParams.prototype.toString = function () {
    var out = [];
    this._m.forEach(function (vs, k) { vs.forEach(function (v) { out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); }); });
    return out.join('&');
  };
}
// AbortController: router-core matchRoutesInternal() constructs one per match;
// on the synchronous render path only the (never-running) async load pipeline
// touches .signal/.abort().
if (typeof globalThis.AbortController === 'undefined') {
  globalThis.AbortController = function AbortController() {
    this.signal = {
      aborted: false,
      reason: undefined,
      onabort: null,
      throwIfAborted: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return false; },
    };
  };
  globalThis.AbortController.prototype.abort = function (reason) {
    this.signal.aborted = true;
    this.signal.reason = reason;
  };
}
// ---- end tanstack-router addendum ----
`

// TanstackPrelude returns the engine prelude for TanStack SSR bundles:
// the renderx default prelude plus the TanStack shims.
func TanstackPrelude() string {
	return renderx.DefaultPrelude + TanstackPreludeAddendum
}

// AppendTanstackAliases adds the isServer alias (the TS-side ESBUILD_ALIASES
// mirror) on top of base, resolving the target against the same node_modules
// tree the rest of the SSR build reads: the web app's own node_modules first,
// then the npm-workspaces hoist root (example/web is a workspace member, so
// @tanstack/router-core typically lands at <repo>/node_modules). TanStack-
// agnostic callers can ignore the extra entry.
func AppendTanstackAliases(base map[string]string, webDir string) map[string]string {
	rel := filepath.Join("@tanstack", "router-core", "dist", "esm", "isServer", "server.js")
	candidates := []string{
		filepath.Join(webDir, "node_modules", rel),
		filepath.Join(webDir, "..", "..", "node_modules", rel),
	}
	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			base["@tanstack/router-core/isServer"] = c
			return base
		}
	}
	// Not found on either path: keep the web-local candidate so the esbuild
	// error names the conventional location instead of going silently wrong.
	base["@tanstack/router-core/isServer"] = candidates[0]
	return base
}
