package authorization

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/haozing/ploykit/authorization"
)

// Resolver maps method+path to a catalog operation ID — the composition-root
// half of the strong profile (arch A6: the framework evaluator never sees
// HTTP shapes). Matching is exact-segment: a segment in braces is a wildcard,
// every other segment must match literally; the segment count must be exact.
// An unknown shape resolves to ok=false and the middleware denies —
// fail-closed is the whole point of the closed-set catalog.
type Resolver struct {
	routes []route
}

type route struct {
	method string
	// segments are the path split on "/", wildcards in braces. Paths are
	// matched without the leading slash, so "DELETE /api/workspaces/{id}"
	// is ["api", "workspaces", "{id}"].
	segments []string
	opID     string
	// wsSeg indexes the segment carrying the workspace id (-1 when the
	// operation has no workspace in its path).
	wsSeg int
}

// NewResolver registers example's strong-profile routes. The subroute-relative
// form exists because workspace/adapters/http mounts
// /api/workspaces/{workspaceId}/ behind an http.StripPrefix, so the
// transfer-ownership subroute reaches this middleware with a relative path.
// token.create is the AAL2-grade reference op (ADR 0013 batch 2): PAT
// creation requires a fresh password AND MFA proof.
func NewResolver() *Resolver {
	return &Resolver{routes: []route{
		{
			method: http.MethodDelete, segments: []string{"api", "workspaces", "{workspaceId}"},
			opID: "workspace.delete", wsSeg: 2,
		},
		{
			method: http.MethodPost, segments: []string{"api", "workspaces", "{workspaceId}", "transfer-ownership"},
			opID: "workspace.transfer_ownership", wsSeg: 2,
		},
		{
			method: http.MethodPost, segments: []string{"{workspaceId}", "transfer-ownership"},
			opID: "workspace.transfer_ownership", wsSeg: 0,
		},
		{
			method: http.MethodPost, segments: []string{"api", "tokens"},
			opID: "token.create", wsSeg: -1,
		},
	}}
}

// Resolve returns the operation ID and the workspace id extracted from the
// request path, or ok=false when no registered route matches.
func (r *Resolver) Resolve(method, path string) (opID, workspaceID string, ok bool) {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	for _, rt := range r.routes {
		if rt.method != method || len(rt.segments) != len(segments) {
			continue
		}
		matched := true
		var wsID string
		for i, pattern := range rt.segments {
			if strings.HasPrefix(pattern, "{") {
				if segments[i] == "" {
					matched = false
					break
				}
				if i == rt.wsSeg {
					wsID = segments[i]
				}
				continue
			}
			if pattern != segments[i] {
				matched = false
				break
			}
		}
		if matched {
			return rt.opID, wsID, true
		}
	}
	return "", "", false
}

// Bind fails startup when the resolver and the catalog disagree: every
// catalog operation must be reachable by at least one route, and every route
// must name a catalog operation. Without this check, catalog drift surfaces
// as runtime denials instead of a boot failure.
func (r *Resolver) Bind(catalog authorization.Catalog) error {
	byOp := make(map[string]bool, len(catalog.Operations))
	for _, op := range catalog.Operations {
		byOp[op.OperationID] = false
	}
	for _, rt := range r.routes {
		reached, declared := byOp[rt.opID]
		if !declared {
			return fmt.Errorf("resolver route %s maps to undeclared operation %q",
				rt.method+" /"+strings.Join(rt.segments, "/"), rt.opID)
		}
		byOp[rt.opID] = reached || true
	}
	for opID, reached := range byOp {
		if !reached {
			return fmt.Errorf("catalog operation %q has no resolver route", opID)
		}
	}
	return nil
}
