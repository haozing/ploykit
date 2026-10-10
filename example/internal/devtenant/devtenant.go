// Package devtenant provisions a ready-to-use default tenant (user + owned
// workspace) for development, testing and seeding — idempotent.
//
// Placement: this helper composes two business domains (identity +
// workspace), so it is product-level assembly rather than a platform
// primitive (A1 boundary: platform/* has zero business dependencies,
// enforced by internal/arch) - hence it lives under example's internal.
// Other products copy it as needed; the SQL source of truth stays in the
// framework repo layer, so it cannot silently decouple.
//
// Field-report origin (aiblog #3): workspace/user tables are owned by the
// framework migrations, but before the first identity flow runs they are
// empty, and every product table with a workspace_id foreign key has nothing
// legal to reference. Products ended up hand-writing "shadow user + default
// workspace" SQL — including quoting the reserved word "user" and knowing
// plan seeds — i.e. framework-internal knowledge.
//
// This helper is intentionally small: it reuses the identity/workspace repos
// (one SQL source of truth, schema evolution stays coherent) and is
// idempotent, so calling it at every boot of a dev environment is fine.
// Production tenant creation keeps going through the normal registration /
// invite flows; do not call this from a request path.
package devtenant

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	idpgrepo "github.com/haozing/ploykit/identity/adapters/pgrepo"
	"github.com/haozing/ploykit/workspace/adapters/pgrepo"
)

// Default holds the conventional dev-tenant identifiers. Products may override
// any of them via Options.
const (
	DefaultEmail     = "dev@tenant.local"
	DefaultUserName  = "Dev Tenant"
	DefaultWorkspace = "dev"
	DefaultWSName    = "Dev Workspace"
)

// Result describes what the call settled on (existing or freshly created).
type Result struct {
	UserID         string
	Email          string
	WorkspaceID    string
	WorkspaceSlug  string
	UserCreated    bool
	WorkspaceExist bool // workspace already existed (idempotent hit)
}

// Options overrides the conventional defaults.
type Options struct {
	Email         string // default dev@tenant.local
	DisplayName   string // default "Dev Tenant"
	WorkspaceSlug string // default "dev"
	WorkspaceName string // default "Dev Workspace"
	// PasswordHash, when non-empty, makes the user password-login capable.
	// The default (empty) creates a credential-less user: fine for seeded
	// data and dev boots, unusable for interactive login.
	PasswordHash string
	// Now overrides the clock (tests). Zero = time.Now().
	Now func() time.Time
}

func (o *Options) email() string {
	if o == nil || o.Email == "" {
		return DefaultEmail
	}
	return o.Email
}

func (o *Options) displayName() string {
	if o == nil || o.DisplayName == "" {
		return DefaultUserName
	}
	return o.DisplayName
}

func (o *Options) wsSlug() string {
	if o == nil || o.WorkspaceSlug == "" {
		return DefaultWorkspace
	}
	return o.WorkspaceSlug
}

func (o *Options) wsName() string {
	if o == nil || o.WorkspaceName == "" {
		return DefaultWSName
	}
	return o.WorkspaceName
}

// Ensure provisions (or finds) the default tenant against pool. Safe to call
// on every boot: existing user/workspace short-circuit without writes.
func Ensure(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger, opts *Options) (Result, error) {
	if opts == nil {
		opts = &Options{}
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	res := Result{Email: opts.email(), WorkspaceSlug: opts.wsSlug()}

	idRepo := idpgrepo.New(pool, idpgrepo.Config{})
	wsRepo := pgrepo.New(pool)

	// user: idempotent by email (the unique constraint is the source of truth).
	var err error
	res.UserID, err = ensureUser(ctx, idRepo, opts, now)
	if err != nil {
		return res, fmt.Errorf("devtenant: user: %w", err)
	}

	// workspace: idempotent by slug (the unique constraint is the source of truth).
	var exists bool
	res.WorkspaceID, exists, err = ensureWorkspace(ctx, wsRepo, opts, res.UserID, now)
	if err != nil {
		return res, fmt.Errorf("devtenant: workspace: %w", err)
	}
	res.WorkspaceExist = exists

	if log != nil {
		log.Info("devtenant ready",
			"email", res.Email, "user_id", res.UserID,
			"workspace_slug", res.WorkspaceSlug, "workspace_id", res.WorkspaceID,
			"workspace_existed", exists)
	}
	return res, nil
}

func ensureUser(ctx context.Context, repo *idpgrepo.Repo, opts *Options, now func() time.Time) (string, error) {
	if u, ok, err := repo.GetUserByEmail(ctx, opts.email()); err != nil {
		return "", err
	} else if ok {
		return u.ID, nil
	}
	if opts.PasswordHash != "" {
		u, err := repo.CreateUserWithPassword(ctx, opts.email(), opts.PasswordHash, opts.displayName())
		if err != nil {
			if again, ok, e2 := repo.GetUserByEmail(ctx, opts.email()); e2 == nil && ok {
				return again.ID, nil
			}
			return "", err
		}
		return u.ID, nil
	}
	// Credential-less users go through UpsertUserByEmail (the same path the
	// verification-code flow uses: password_hash stays NULL, satisfying
	// user_password_hash_check; an email conflict just bumps the timestamp and
	// returns the existing user - idempotent by construction).
	u, err := repo.UpsertUserByEmail(ctx, opts.email(), now())
	if err != nil {
		return "", err
	}
	return u.ID, nil
}

func ensureWorkspace(ctx context.Context, repo *pgrepo.Repo, opts *Options, ownerUserID string, now func() time.Time) (id string, existed bool, err error) { //nolint:unparam
	if wsID, ok, e := repo.FindWorkspaceIDBySlug(ctx, opts.wsSlug()); e != nil {
		return "", false, e
	} else if ok {
		return wsID, true, nil
	}
	ws, err := repo.CreateWorkspaceWithOwner(ctx, opts.wsSlug(), opts.wsName(), ownerUserID, now())
	if err != nil {
		// Concurrent-boot race: slug unique-constraint hit -> read back.
		if againID, ok, e2 := repo.FindWorkspaceIDBySlug(ctx, opts.wsSlug()); e2 == nil && ok {
			return againID, true, nil
		}
		return "", false, err
	}
	return ws.ID, false, nil
}
