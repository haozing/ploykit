package pg

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

func WithTenant(ctx context.Context, db Beginner, id Identity, fn func(ctx context.Context, tx pgx.Tx) error) error {
	if outer, ok := ctx.Value(tenantKey{}).(Identity); ok {
		return fmt.Errorf("pg: WithTenant nested inside WithTenant (outer workspace %s): nesting rejected, inner scope would widen row visibility; start a separate top-level transaction instead", outer.WorkspaceID)
	}
	if _, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return fmt.Errorf("pg: WithTenant called inside an existing transaction (Within scope): the tenant channel must own its transaction boundary; move the whole unit of work into WithTenant instead of nesting")
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

	if _, err := tx.Exec(ctx,
		`SELECT set_config('`+gucWorkspaceID+`', $1, true), set_config('`+gucUserID+`', $2, true)`,
		id.WorkspaceID.String(), id.UserID.String()); err != nil {
		return fmt.Errorf("pg: set tenant context: %w", err)
	}
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
