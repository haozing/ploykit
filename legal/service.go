package legal

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/haozing/ploykit/platform/webx"
)

// Auditor is the audit surface the legal module consumes — the exact Record
// signature of *audit.Recorder, as an interface so hermetic tests substitute
// a fake. Record is fire-and-forget by contract (it logs its own failures),
// so an audit write can never fail a user-facing operation.
type Auditor interface {
	Record(ctx context.Context, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any)
}

// Service carries the user-facing legal operations: explicit re-acceptance
// and the admin acceptance-history query. The implicit write points live on
// the identity hooks (Module.Hooks); this is everything that needs a
// principal or an operator's eye.
type Service struct {
	repo    AcceptanceRepo
	auditor Auditor
	log     *slog.Logger
	now     func() time.Time
}

// Audit action / resource names for the re-acceptance write.
const (
	actionReaccept  = "legal.acceptance.reaccept"
	resourceTypeDoc = "legal_doc"
)

// Reaccept records an explicit, user-initiated acceptance of one document's
// current version (POST /api/legal/acceptances territory — the handler is a
// thin wrapper around this call). Idempotent: re-accepting a version the
// user already recorded is a silent no-op (first evidence wins), which is
// exactly what a re-submit double-click should do. When an Auditor is wired
// the action lands in the audit trail with the version, method and IP.
func (s *Service) Reaccept(ctx context.Context, p *webx.Principal, docKey string) error {
	if p == nil || p.UserID == "" {
		return webx.NewValidation("legal: reaccept requires an authenticated principal")
	}
	doc, ok := docByKey(docKey)
	if !ok {
		return webx.NewValidation("legal: unknown document key " + docKey)
	}
	env := evidenceFrom(ctx)
	if err := s.repo.InsertAcceptances(ctx, rowsFor(p.UserID, []Doc{doc}, MethodReaccept, env)); err != nil {
		return err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, actionReaccept, resourceTypeDoc, doc.Key, map[string]any{
			"doc_version": doc.Version,
			"method":      MethodReaccept,
			"ip":          env.ip,
		})
	}
	return nil
}

// AcceptancesByUser returns a user's full acceptance history, newest first —
// the admin evidence export behind "which version did this user agree to"
// disputes and DSAR responses.
func (s *Service) AcceptancesByUser(ctx context.Context, userID string) ([]Acceptance, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return nil, webx.NewValidation("legal: userID must be a UUID")
	}
	return s.repo.AcceptancesByUser(ctx, userID)
}
