package arch

import (
	"testing"

	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/wsx"
)

// TestPATPrefixParity pins the PAT token prefix across its three independent
// definition sites. The PAT chain spans three layers: identity/domain mints
// the token, webx parses the Bearer header, and wsx authenticates the first
// WebSocket control frame. If any site drifts, tokens minted by one layer are
// silently rejected by another — a break with no compile-time signal.
//
// webx.DefaultPATPrefix is the canonical constant (lowest layer, importable by
// everyone who needs it). identity/domain keeps a mirrored const because the
// domain layer is deliberately pure stdlib (no framework imports), and wsx
// aliases webx. This test turns silent drift into a build failure.
//
// The "tk_" anchor is asserted separately: renaming the prefix is a wire-format
// change (every stored token hash and every deployed client is affected), not
// a refactor — it must be a conscious decision, not collateral drift.
// (orkome field feedback F6.)
func TestPATPrefixParity(t *testing.T) {
	const anchor = "tk_"

	if webx.DefaultPATPrefix != anchor {
		t.Errorf("webx.DefaultPATPrefix = %q, want anchor %q: the canonical constant drifted; renaming the prefix is a wire-format change affecting all stored tokens", webx.DefaultPATPrefix, anchor)
	}
	if domain.DefaultPATPrefix != webx.DefaultPATPrefix {
		t.Errorf("identity/domain.DefaultPATPrefix = %q, want %q: the mint side must mirror the canonical webx constant (PAT chain: mint -> parse -> ws auth)", domain.DefaultPATPrefix, webx.DefaultPATPrefix)
	}
	if wsx.DefaultPATPrefix != webx.DefaultPATPrefix {
		t.Errorf("wsx.DefaultPATPrefix = %q, want %q: the ws auth gate must mirror the canonical webx constant (PAT chain: mint -> parse -> ws auth)", wsx.DefaultPATPrefix, webx.DefaultPATPrefix)
	}
}
