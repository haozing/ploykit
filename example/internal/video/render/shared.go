package render

import (
	"context"
	"encoding/json"
	"time"

	videoapp "myproduct/internal/video/app"
	"github.com/haozing/ploykit/platform/storagex"
)

// QuotaReleaser is the compensation port (adapter wraps quota.Service).
type QuotaReleaser interface {
	Release(ctx context.Context, workspaceID, key string, n int64, now time.Time) error
}

// quotaKeyAlias re-exports the app quota key (single source of truth).
const quotaKeyAlias = videoapp.QuotaKey

func jsonUnmarshal(b []byte, into any) error { return json.Unmarshal(b, into) }

// storagexStore aliases the store interface for the pipeline files.
type storagexStore = storagex.Store
