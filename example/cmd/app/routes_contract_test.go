package main

// Runtime route-set contract test: the routes the production app actually
// mounts (via the framework Mount functions, the same ones main.go calls)
// must equal docs/openapi.yaml — the runtime twin of the static regex scan
// tools/check_api.py, in a form any product can copy (no fake-request
// probing, no repo-specific file list).

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"

	adminhttp "github.com/haozing/ploykit/admin/adapters/http"
	audithttp "github.com/haozing/ploykit/audit/adapters/http"
	billinghttp "github.com/haozing/ploykit/billing/adapters/http"
	identityhttp "github.com/haozing/ploykit/identity/adapters/http"
	notifyhttp "github.com/haozing/ploykit/notify/adapters/http"
	"github.com/haozing/ploykit/platform/webx"
	quotahttp "github.com/haozing/ploykit/quota/adapters/http"
	schedulehttp "github.com/haozing/ploykit/schedule/adapters/http"
	settingshttp "github.com/haozing/ploykit/settings/adapters/http"
	webhookhttp "github.com/haozing/ploykit/webhooks/adapters/http"
	workspacehttp "github.com/haozing/ploykit/workspace/adapters/http"

	"myproduct/internal/task"
)

// expectedRouteCount pins the total endpoint count to the value
// `python tools/check_api.py` reports at the repo root (spec == code, zero
// drift). The static twin guard and this runtime test must stay in lockstep:
// when a route is added or removed, update this constant in the same change.
const expectedRouteCount = 136

// passthrough mirrors main.go's identity/schedule middleware shape for Mounts
// that fail fast on nil guards.
func passthrough(next http.Handler) http.Handler { return next }

func noopHandler(http.ResponseWriter, *http.Request) {}

// mountProductionRoutes registers every route of the production app onto mux,
// mirroring the mount list of example/cmd/app/main.go one-for-one (framework
// domain Mounts + the inline product routes). Deps are registration-safe zero
// values: Mount functions only build handler closures over them — nothing is
// dereferenced until a request arrives, and this test never sends one. The
// two explicit guards exist because those Mounts panic on nil guards by
// design (fail-fast wiring contract).
func mountProductionRoutes(mux *webx.Mux) {
	// main.go: metrics mount + SPA catch-all — both method-less patterns, so
	// they are recorded as mounts, not endpoints (skipped below, the same
	// convention tools/check_api.py applies). "/metrics" is the default
	// PLOYKIT_METRICS_PATH; the real path is env-configurable but never
	// carries a method prefix.
	mux.Handle("/metrics", http.NotFoundHandler())
	mux.Handle("/", http.NotFoundHandler())

	identityhttp.Mount(mux, identityhttp.Deps{})
	workspacehttp.Mount(mux, workspacehttp.Deps{})
	identityhttp.MountFedAdmin(mux, identityhttp.Deps{FedAdminGuard: passthrough})
	billinghttp.Mount(mux, billinghttp.Deps{})
	notifyhttp.Mount(mux, notifyhttp.Deps{})
	mux.HandleFunc("GET /api/notification-types", noopHandler)
	quotahttp.Mount(mux, quotahttp.Deps{})
	mux.HandleFunc("GET /ws", noopHandler)
	task.Mount(mux, task.Deps{}, passthrough)
	schedulehttp.Mount(mux, schedulehttp.Deps{})
	adminhttp.Mount(mux, adminhttp.Deps{})
	adminhttp.MountUserOps(mux, adminhttp.UserOpsDeps{})
	adminhttp.MountWsOps(mux, adminhttp.WsOpsDeps{})
	adminhttp.MountBillingOps(mux, adminhttp.BillingOpsDeps{})
	settingshttp.MountAdmin(mux, settingshttp.AdminDeps{Guard: passthrough})
	audithttp.Mount(mux, audithttp.Deps{})
	webhookhttp.Mount(mux, webhookhttp.Deps{})
	mux.HandleFunc("GET /config", noopHandler)
	mux.HandleFunc("GET /healthz", noopHandler)
	mux.HandleFunc("GET /readyz", noopHandler)
	mux.HandleFunc("GET /debug/pool", noopHandler)
}

// runtimeRoutes returns the production endpoint set as "METHOD /path" keys.
// Method-less patterns are mounts/catch-alls, not endpoints — skipped, the
// same convention tools/check_api.py applies. The workspace domain serves its
// sub-routes from an internal sub-mux under "/api/workspaces/{workspaceId}/",
// so its absolute route infos come from SubrouteInfos (the root mux records
// only the subtree mount).
func runtimeRoutes(t *testing.T) []string {
	t.Helper()
	mux := webx.NewMux()
	mountProductionRoutes(mux)

	routes := mux.Routes()
	routes = append(routes, workspacehttp.SubrouteInfos()...)

	keys := make([]string, 0, len(routes))
	for _, ri := range routes {
		if ri.Method == "" {
			continue
		}
		keys = append(keys, ri.Method+" "+ri.Path)
	}
	sort.Strings(keys)
	return keys
}

// openapiRoutes parses docs/openapi.yaml and returns its endpoint set as
// "METHOD /path" keys (every HTTP-method operation under paths:, matching
// tools/check_api.py's method vocabulary).
func openapiRoutes(t *testing.T, data []byte) []string {
	t.Helper()
	var doc struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	require.NoError(t, yaml.Unmarshal(data, &doc))
	require.NotEmpty(t, doc.Paths, "openapi document has no paths object")

	var keys []string
	for path, item := range doc.Paths {
		for method := range item {
			switch strings.ToLower(method) {
			case "get", "post", "put", "patch", "delete", "head", "options", "trace":
				keys = append(keys, strings.ToUpper(method)+" "+path)
			}
		}
	}
	sort.Strings(keys)
	return keys
}

func TestRuntimeRoutesMatchOpenAPI(t *testing.T) {
	runtime := runtimeRoutes(t)
	assert.Len(t, runtime, expectedRouteCount,
		"runtime endpoint count drifted from the pinned check_api.py total; if routes were added/removed on purpose, update expectedRouteCount together with docs/openapi.yaml")

	// catch silent double-mounting: Routes() records every registration, so a
	// duplicate key means two domains (or a domain + inline wiring) claim the
	// same endpoint
	seen := make(map[string]bool, len(runtime))
	for _, k := range runtime {
		assert.False(t, seen[k], "runtime route registered twice: %s", k)
		seen[k] = true
	}

	data, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "openapi.yaml"))
	require.NoError(t, err, "docs/openapi.yaml must be reachable from the example module (repo root is three levels up)")
	spec := openapiRoutes(t, data)
	assert.Len(t, spec, expectedRouteCount, "docs/openapi.yaml drifted from the pinned check_api.py total")

	var specOnly, runtimeOnly []string
	specSet := make(map[string]bool, len(spec))
	for _, k := range spec {
		specSet[k] = true
		if !seen[k] {
			specOnly = append(specOnly, k)
		}
	}
	for _, k := range runtime {
		if !specSet[k] {
			runtimeOnly = append(runtimeOnly, k)
		}
	}
	if len(specOnly) == 0 && len(runtimeOnly) == 0 {
		return
	}
	var b strings.Builder
	b.WriteString("runtime mounted routes vs docs/openapi.yaml drift:")
	for _, k := range specOnly {
		fmt.Fprintf(&b, "\n  spec-only  (registered in openapi.yaml but not mounted): %s", k)
	}
	for _, k := range runtimeOnly {
		fmt.Fprintf(&b, "\n  code-only  (mounted but missing from openapi.yaml): %s", k)
	}
	t.Fatal(b.String())
}
