package pg

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	gucWorkspaceID = "app.workspace_id"
	gucUserID      = "app.user_id"
)

type Identity struct {
	WorkspaceID uuid.UUID
	UserID      uuid.UUID
}

type Beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

func (d *DB) Begin(ctx context.Context) (pgx.Tx, error) { return d.primary.Begin(ctx) }

type tenantKey struct{}

// rejectNestedTenantScope enforces that the tenant channel owns its
// transaction boundary: a nested call would either widen row visibility
// (WithTenant inside WithTenant) or silently scope a *different* transaction
// than the ambient one (inside Within/WithService), leaving the caller's
// actual transaction unscoped.
func rejectNestedTenantScope(ctx context.Context, kind string) error {
	if outer, ok := ctx.Value(tenantKey{}).(Identity); ok {
		return fmt.Errorf("pg: %s nested inside WithTenant (outer workspace %s): nesting rejected, inner scope would widen row visibility; start a separate top-level transaction instead", kind, outer.WorkspaceID)
	}
	if _, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return fmt.Errorf("pg: %s called inside an existing transaction (Within scope): the tenant channel must own its transaction boundary; move the whole unit of work into WithTenant instead of nesting", kind)
	}
	return nil
}

// beginTenantTx opens a transaction and sets the tenant GUCs as
// transaction-scoped config (set_config ... is_local => true): they live and
// die with this transaction, so a pooled connection never carries tenant
// context between checkouts. Shared by WithTenant, TenantExec and TenantScan.
func beginTenantTx(ctx context.Context, db Beginner, id Identity) (pgx.Tx, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("pg: begin: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`SELECT set_config('`+gucWorkspaceID+`', $1, true), set_config('`+gucUserID+`', $2, true)`,
		id.WorkspaceID.String(), id.UserID.String()); err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, fmt.Errorf("pg: set tenant context: %w", err)
	}
	return tx, nil
}

func WithTenant(ctx context.Context, db Beginner, id Identity, fn func(ctx context.Context, tx pgx.Tx) error) error {
	if err := rejectNestedTenantScope(ctx, "WithTenant"); err != nil {
		return err
	}
	tx, err := beginTenantTx(ctx, db, id)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()

	tctx := context.WithValue(context.WithValue(ctx, txKey{}, tx), tenantKey{}, id)
	if err := fn(tctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("pg: commit: %w", err)
	}
	committed = true
	return nil
}

func WithService(ctx context.Context, db Beginner, fn func(ctx context.Context, tx pgx.Tx) error) error {
	if _, ok := ctx.Value(tenantKey{}).(Identity); ok {
		return fmt.Errorf("pg: WithService called inside WithTenant: the service escape hatch must be a separate top-level transaction, not nested in a tenant scope")
	}
	if _, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return fmt.Errorf("pg: WithService called inside an existing transaction (Within/Tenant scope): the service escape hatch must be a separate top-level transaction, not nested")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("pg: begin: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()
	if err := fn(context.WithValue(ctx, txKey{}, tx), tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("pg: commit: %w", err)
	}
	committed = true
	return nil
}

// TenantExec runs ONE statement inside a transaction that carries the tenant
// GUCs, committing immediately. Multi-statement units of work belong in
// WithTenant. Each call costs one BEGIN/COMMIT round trip — that is the price
// of correct tenant scoping; do not be tempted to set session-level GUCs on a
// pooled connection instead (cross-tenant leak).
func TenantExec(ctx context.Context, db Beginner, id Identity, sql string, args ...any) (pgconn.CommandTag, error) {
	if err := rejectNestedTenantScope(ctx, "TenantExec"); err != nil {
		return pgconn.CommandTag{}, err
	}
	tx, err := beginTenantTx(ctx, db, id)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()
	tag, err := tx.Exec(ctx, sql, args...)
	if err != nil {
		return pgconn.CommandTag{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return pgconn.CommandTag{}, fmt.Errorf("pg: commit: %w", err)
	}
	committed = true
	return tag, nil
}

// TenantScan runs ONE query inside the same scoped transaction and scans a
// SINGLE row into dest (pgx QueryRow semantics). Deliberately NOT a
// rows-returning helper: streaming rows would force the transaction (and the
// tenant scope) to outlive the call.
func TenantScan(ctx context.Context, db Beginner, id Identity, sql string, args []any, dest ...any) error {
	if err := rejectNestedTenantScope(ctx, "TenantScan"); err != nil {
		return err
	}
	tx, err := beginTenantTx(ctx, db, id)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()
	if err := tx.QueryRow(ctx, sql, args...).Scan(dest...); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("pg: commit: %w", err)
	}
	committed = true
	return nil
}
