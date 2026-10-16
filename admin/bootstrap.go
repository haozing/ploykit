package admin

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BootstrapPlatformAdmin covers the zero-to-one platform-admin bootstrap: when
// no platform admin exists yet, it promotes the user identified by email
// (case-insensitive). The caller (product main.go) reads the env var and passes
// the address in — the framework function never touches the environment.
//
// Semantics (deliberately narrow):
//   - empty/blank email → info-skip (feature off);
//   - any platform admin already exists → info-skip (only ever 0→1: a
//     post-compromise env flip cannot mint a second admin, and nothing here
//     ever demotes);
//   - email not registered yet → warn-skip, not an error (deploy-before-
//     register is a legal order; the next boot retries);
//   - no audit record: no principal exists at boot, the startup log is the
//     trail. Ongoing grants/revokes keep going through
//     PATCH /api/admin/users/{id}/admin.
//
// Idempotent on every boot; call once after migrations have run.
func BootstrapPlatformAdmin(ctx context.Context, pool *pgxpool.Pool, email string, log *slog.Logger) error {
	if log == nil {
		log = slog.Default()
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		log.Info("bootstrap admin: no bootstrap email configured, skipping")
		return nil
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM "user" WHERE is_platform_admin`).Scan(&n); err != nil {
		return fmt.Errorf("bootstrap admin: count platform admins: %w", err)
	}
	if n > 0 {
		log.Info("bootstrap admin: platform admin already exists, skipping", "admins", n)
		return nil
	}
	ct, err := pool.Exec(ctx, `UPDATE "user" SET is_platform_admin = true WHERE lower(email) = $1`, email)
	if err != nil {
		return fmt.Errorf("bootstrap admin: promote %s: %w", email, err)
	}
	if ct.RowsAffected() == 0 {
		log.Warn("bootstrap admin: no user with this email yet (register first), skipping", "email", email)
		return nil
	}
	log.Info("bootstrap admin: promoted first platform admin", "email", email)
	return nil
}
