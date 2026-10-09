package admin

import "context"

type Hooks struct {
	OnImpersonation func(ctx context.Context, adminUserID, targetUserID string) error
}
