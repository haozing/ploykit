// Package renderx implements the SSR render pipeline (QuickJS engine pool,
// bundle build, prerender, cache, SEO companions).
//
// This file owns the pipeline's TanStack Router SSR affordances. The
// JavaScript source of truth for both values below is
// packages/runtime/src/router-tanstack.tsx:
//
//   - PRELUDE_SHIMS — the QuickJS prelude addendum (URLSearchParams +
//     AbortController) every TanStack SSR bundle needs before it evaluates.
//   - ESBUILD_ALIASES — the esbuild alias pinning
//     @tanstack/router-core/isServer to the server variant. The default
//     (client) variant evaluates `window?.origin` inside the sandbox, where
//     window is deliberately never defined, and crashes the render.
//
// The Go render pipeline must carry an executable copy of both: it builds the
// prelude string and the esbuild alias map natively, so a TS-only constant
// cannot reach it. Keeping that copy here (rather than in every product)
// exists because the alternative is a hand-maintained mirror per TanStack
// consumer: the TS runtime moves, the product copy does not, and the product
// silently runs an outdated shim with zero detection (exactly what happened
// in v0.10.1). Products import renderx.TanstackPrelude and
// renderx.AppendTanstackAliases instead of mirroring the constants.
//
// tanstack_test.go is the drift guard: it parses router-tanstack.tsx and fails
// when this file diverges from the TS source. The framework repo is where
// drift can happen, so the guard runs there; from a module cache (no
// packages/ checkout) it skips.
package renderx

import (
	"os"
	"path/filepath"
)

// tanstackPreludeAddendum is the Go raw-string mirror of PRELUDE_SHIMS
// (@ploykit/runtime/router-tanstack). It is byte-identical to the TS template
// literal body, including the leading and trailing newline; keep the two in
// lockstep (the drift guard in tanstack_test.go enforces this).
//
// The split/join ('+'-as-space) form in the shim is deliberate: the text
// contains no backslash, so a Go raw-string literal and a JS template literal
// can carry byte-identical content (a /\+/g regex literal would need different
// escaping per language).
const tanstackPreludeAddendum = `
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

// TanstackPrelude returns the engine prelude for TanStack SSR bundles: the
// renderx default prelude plus the TanStack shims (the Go side of
// PRELUDE_SHIMS). Pass it as PoolOptions.Prelude:
//
//	renderx.NewEnginePool(bundle, renderx.PoolOptions{Prelude: renderx.TanstackPrelude()})
func TanstackPrelude() string {
	return DefaultPrelude + tanstackPreludeAddendum
}

// AppendTanstackAliases adds the isServer alias (the Go side of the TS-side
// ESBUILD_ALIASES) on top of base, resolving the target against the same
// node_modules tree the rest of the SSR build reads: the web app's own
// node_modules first, then the npm-workspaces hoist root
// (webDir/../../node_modules — a web app that is a workspace member usually
// resolves @tanstack/router-core at the repo root). TanStack-agnostic callers
// can ignore the extra entry; the returned map is base.
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
