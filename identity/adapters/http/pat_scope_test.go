package http

import (
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/webx"
)

// The scope contract on the create face (orkome field report #1): nil =
// unrestricted, a non-nil EMPTY list = allow-nothing (rejected as ambiguous
// instead of minting a useless token), entries must be workspace UUIDs, and
// the list is capped.
func TestValidatePATScope(t *testing.T) {
	cases := []struct {
		name    string
		scope   *webx.CredentialScope
		wantErr string // empty = accepted
	}{
		{"nil scope = unrestricted", nil, ""},
		{"nil lists = unrestricted", &webx.CredentialScope{}, ""},
		{"workspace ids empty non-nil = ambiguous", &webx.CredentialScope{WorkspaceIDs: []string{}}, "empty list means allow-nothing"},
		{"permissions empty non-nil = ambiguous", &webx.CredentialScope{Permissions: []string{}}, "empty list means allow-nothing"},
		{"valid single workspace", &webx.CredentialScope{WorkspaceIDs: []string{"67478775-e301-4283-8255-208743ba1ec8"}}, ""},
		{"garbage workspace id", &webx.CredentialScope{WorkspaceIDs: []string{"not-a-uuid"}}, "not a workspace id"},
		{"over the cap", &webx.CredentialScope{WorkspaceIDs: make([]string, maxScopeWorkspaceIDs+1)}, "exceeds the limit"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validatePATScope(tc.scope)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("want accept, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("want rejection naming %q, got nil", tc.wantErr)
			}
			if err.Status != 400 || !strings.Contains(err.Message, tc.wantErr) {
				t.Fatalf("want 400 naming %q, got %d %q", tc.wantErr, err.Status, err.Message)
			}
		})
	}
}
