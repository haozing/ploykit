package renderx

// Drift guard for the TanStack SSR affordances.
//
// tanstack.go carries a Go executable copy of two constants that live in
// packages/runtime/src/router-tanstack.tsx:
//
//   - PRELUDE_SHIMS  -> tanstackPreludeAddendum / TanstackPrelude
//   - ESBUILD_ALIASES -> AppendTanstackAliases
//
// Go cannot import a TS constant, so the copy is unavoidable; the failure mode
// is silent (a product keeps running an outdated shim, or an alias pointing at
// a removed file). This test parses the TS source and fails when the two sides
// diverge. The framework repo is where that edit happens, so the guard runs
// here; from a module cache (consumers invoking `go test` on the downloaded
// module) the packages/ tree does not exist and the test skips.

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const tanstackTSSource = "../../packages/runtime/src/router-tanstack.tsx"

// normalizeJS collapses all whitespace runs to a single space. The TS
// template literal and the Go raw string are byte-identical today; normalizing
// keeps the guard about content drift, not reindentation of the enclosing
// file (gofmt/tabs vs TS spaces).
func normalizeJS(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// extractTemplateLiteral returns the body of the template literal that starts
// at the first backtick at or after marker. It stops at the next unescaped
// backtick; a backslash skips the following byte. Returns ok=false when the
// marker or the terminating backtick is missing.
func extractTemplateLiteral(src, marker string) (body string, ok bool) {
	i := strings.Index(src, marker)
	if i < 0 {
		return "", false
	}
	start := i + len(marker)
	for j := start; j < len(src); j++ {
		switch src[j] {
		case '\\':
			j++ // escaped byte (e.g. \`), not a terminator
		case '`':
			return src[start:j], true
		}
	}
	return "", false
}

func TestTanstackTSSourceDrift(t *testing.T) {
	src, err := os.ReadFile(tanstackTSSource)
	if err != nil {
		if os.IsNotExist(err) {
			t.Skipf("TS source not present (%s): the drift guard runs in the framework repo; a module-cache checkout has no packages/ tree", tanstackTSSource)
		}
		t.Fatalf("read %s: %v", tanstackTSSource, err)
	}
	text := string(src)

	// (a) PRELUDE_SHIMS equals the Go addendum modulo whitespace.
	tsShims, ok := extractTemplateLiteral(text, "export const PRELUDE_SHIMS = `")
	if !ok {
		t.Fatalf("PRELUDE_SHIMS template literal not found in %s", tanstackTSSource)
	}
	if got, want := normalizeJS(tanstackPreludeAddendum), normalizeJS(tsShims); got != want {
		t.Errorf("tanstackPreludeAddendum drifted from PRELUDE_SHIMS in %s\n"+
			"update platform/renderx/tanstack.go to match the TS source\n"+
			"Go : %q\nTS : %q", tanstackTSSource, got, want)
	}
	if !strings.HasSuffix(TanstackPrelude(), tsShims) {
		t.Errorf("TanstackPrelude() must end with the TS PRELUDE_SHIMS text")
	}
	if !strings.HasPrefix(TanstackPrelude(), DefaultPrelude) {
		t.Errorf("TanstackPrelude() must start with DefaultPrelude")
	}

	// (b) ESBUILD_ALIASES: parse the key and its relative target out of the
	// object literal, then assert AppendTanstackAliases emits exactly that
	// key and resolves it to the parsed relative path.
	const aliasMarker = "export const ESBUILD_ALIASES"
	i := strings.Index(text, aliasMarker)
	if i < 0 {
		t.Fatalf("ESBUILD_ALIASES not found in %s", tanstackTSSource)
	}
	aliasBody := text[i:]
	if end := strings.Index(aliasBody, "\n}"); end >= 0 {
		aliasBody = aliasBody[:end]
	}
	entry := regexp.MustCompile(`'([^']+)'\s*:\s*'([^']+)'`).FindStringSubmatch(aliasBody)
	if entry == nil {
		t.Fatalf("could not parse an alias entry out of ESBUILD_ALIASES in %s", tanstackTSSource)
	}
	tsKey, tsTarget := entry[1], entry[2]

	webDir := t.TempDir() // no node_modules here: forces the conventional-path fallback
	aliases := AppendTanstackAliases(map[string]string{}, webDir)
	gotTarget, present := aliases[tsKey]
	if !present {
		t.Fatalf("AppendTanstackAliases did not set the TS alias key %q (got keys: %v)", tsKey, aliases)
	}
	// The TS value is a package-relative specifier; the Go side expands it
	// under webDir/node_modules. Compare the relative tails so the assertion
	// pins the key AND the target file selection.
	wantSuffix := filepath.FromSlash(tsTarget)
	if !strings.HasSuffix(gotTarget, wantSuffix) {
		t.Errorf("alias target drifted: AppendTanstackAliases resolved %q, TS ESBUILD_ALIASES says %q", gotTarget, tsTarget)
	}
}
