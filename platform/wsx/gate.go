package wsx

import (
	"context"

	"github.com/haozing/ploykit/platform/webx"
)

func MemberGate(lookup func(ctx context.Context, workspaceID, userID string) (bool, error)) WorkspaceMember {
	return func(ctx context.Context, p *webx.Principal, workspaceID string) bool {
		if p == nil {
			return false
		}
		if p.IsPlatformAdmin {
			return true
		}
		if lookup == nil {
			return false
		}
		ok, err := lookup(ctx, workspaceID, p.UserID)
		if err != nil {
			return false
		}
		return ok
	}
}
