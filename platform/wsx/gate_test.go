package wsx

import (
	"context"
	"errors"
	"testing"

	"github.com/haozing/ploykit/platform/webx"
)

func TestMemberGate(t *testing.T) {
	t.Parallel()
	lookupErr := errors.New("member lookup down")
	cases := []struct {
		name      string
		p         *webx.Principal
		member    bool
		lookupErr error
		want      bool
		wantCalls int
	}{
		{
			name:      "nil principal fail-closed",
			p:         nil,
			want:      false,
			wantCalls: 0,
		},
		{
			name:      "platform admin exempt across workspaces",
			p:         &webx.Principal{UserID: "root", Source: webx.SourceSession, IsPlatformAdmin: true},
			want:      true,
			wantCalls: 0,
		},
		{
			name:      "lookup error fail-closed",
			p:         &webx.Principal{UserID: "u1", Source: webx.SourceSession},
			lookupErr: lookupErr,
			want:      false,
			wantCalls: 1,
		},
		{
			name:      "member allowed",
			p:         &webx.Principal{UserID: "u1", Source: webx.SourceSession},
			member:    true,
			want:      true,
			wantCalls: 1,
		},
		{
			name:      "non-member denied",
			p:         &webx.Principal{UserID: "u1", Source: webx.SourceSession},
			member:    false,
			want:      false,
			wantCalls: 1,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var calls int
			var gotWS, gotUID string
			gate := MemberGate(func(_ context.Context, workspaceID, userID string) (bool, error) {
				calls++
				gotWS, gotUID = workspaceID, userID
				return tc.member, tc.lookupErr
			})
			if got := gate(context.Background(), tc.p, "ws1"); got != tc.want {
				t.Fatalf("gate() = %v, want %v", got, tc.want)
			}
			if calls != tc.wantCalls {
				t.Fatalf("lookup calls = %d, want %d", calls, tc.wantCalls)
			}
			if tc.wantCalls == 1 && (gotWS != "ws1" || gotUID != tc.p.UserID) {
				t.Fatalf("lookup args = (%q, %q), want (%q, %q)", gotWS, gotUID, "ws1", tc.p.UserID)
			}
		})
	}
}

func TestMemberGateNilLookupFailClosed(t *testing.T) {
	t.Parallel()
	gate := MemberGate(nil)
	if gate(context.Background(), &webx.Principal{UserID: "u1", Source: webx.SourceSession}, "ws1") {
		t.Fatal("nil lookup gate() = true, want false (fail-closed)")
	}
}
