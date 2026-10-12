package devx

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"time"
)

// Check constructors for the framework's classic boot failures. Each returns
// a Check the product registers into its Doctor; all are opt-in per wiring —
// a product that genuinely doesn't use a feature skips that check.

// RiverSchemaCheck verifies the river schema was migrated (events.Migrate was
// called at boot). Symptom when skipped: the first transactional event dies
// with `relation "river_job" does not exist`, two layers away from the cause.
// conn is a plain *sql.DB (or anything running SQL) — devx does not depend on
// pgx directly here so any driver works.
func RiverSchemaCheck(conn *sql.DB) Check {
	return Check{
		Name:    "river_schema",
		Summary: "river job-queue schema is migrated (events.Migrate ran at boot)",
		Run: func(ctx context.Context) Result {
			var n int
			err := conn.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_name = 'river_job'`).Scan(&n)
			if err != nil {
				return Result{Pass: false, Detail: "cannot query the schema: " + err.Error(), FixHint: "check the database connection; the check needs SELECT on information_schema"}
			}
			if n == 0 {
				return Result{Pass: false, Detail: `table "river_job" does not exist`, FixHint: "call events.Migrate(ctx, pool) at boot after events.New and before workers start"}
			}
			return Result{Pass: true, Detail: "river_job present"}
		},
	}
}

// SealKeyCheck verifies tenant-credential encryption is configured. Without
// PLOYKIT_SEAL_KEY, new secret writes are rejected and legacy plaintext rows
// error on read — surfaced to the product as a confusing runtime failure,
// never as a boot error.
func SealKeyCheck(keyEnv string) Check {
	if keyEnv == "" {
		keyEnv = "PLOYKIT_SEAL_KEY"
	}
	return Check{
		Name:    "seal_key",
		Summary: "credential encryption key (" + keyEnv + ") is configured",
		Run: func(ctx context.Context) Result {
			if os.Getenv(keyEnv) == "" {
				return Result{Pass: false, Detail: keyEnv + " is not set", FixHint: "generate with `openssl rand -base64 32`; without it tenants cannot store new credentials (sealx contract)"}
			}
			return Result{Pass: true, Detail: "set"}
		},
	}
}

// CookieSecureCheck catches the production trap of Secure=false cookies behind
// HTTPS (session cookies leaked over plain HTTP) and the inverse dev trap of
// forcing Secure on local HTTP (logins fail with an opaque CSRF error).
func CookieSecureCheck(secureCookie, production bool) Check {
	return Check{
		Name:    "cookie_secure",
		Summary: "auth cookie Secure flag matches the deployment shape",
		Run: func(ctx context.Context) Result {
			switch {
			case production && !secureCookie:
				return Result{Pass: false, Detail: "production deployment with Secure=false auth cookies", FixHint: "set cfg.Secure = true (wire SECURE_COOKIE) — sessions must not go over plain HTTP in production"}
			case !production && secureCookie:
				return Result{Pass: false, Detail: "local/insecure deployment with Secure=true cookies", FixHint: "leave SECURE_COOKIE unset locally; Secure cookies on plain HTTP make login fail with an opaque CSRF error"}
			}
			return Result{Pass: true, Detail: "consistent"}
		},
	}
}

// DrainWindowCheck verifies the graceful-shutdown drain window covers the
// events soft-stop window (SoftStopTimeout + margin). A shorter Drain
// force-kills in-flight event handlers mid-work.
func DrainWindowCheck(drain, softStop time.Duration) Check {
	if softStop <= 0 {
		softStop = 30 * time.Second
	}
	margin := 15 * time.Second
	return Check{
		Name:    "drain_window",
		Summary: "workers.Drain timeout covers the events soft-stop window",
		Run: func(ctx context.Context) Result {
			need := softStop + margin
			if drain < need {
				return Result{
					Pass:    false,
					Detail:  fmt.Sprintf("Drain(%s) truncates the design window (soft-stop %s + %s margin = %s)", drain, softStop, margin, need),
					FixHint: fmt.Sprintf("drain for at least %s: wk.Drain(%d * time.Second)", need, int(need.Seconds())),
				}
			}
			return Result{Pass: true, Detail: fmt.Sprintf("Drain(%s) >= %s", drain, need)}
		},
	}
}

// HealthProbesCheck verifies the readiness endpoint actually probes
// dependencies (a bare-200 readiness check stays green through a database
// outage and the LB keeps routing to a dead instance).
func HealthProbesCheck(readyChecks int) Check {
	return Check{
		Name:    "health_probes",
		Summary: "readiness endpoint probes critical dependencies",
		Run: func(ctx context.Context) Result {
			if readyChecks == 0 {
				return Result{Pass: false, Detail: "no dependency probes registered on readiness", FixHint: "webx.NewHealth().AddCheck per critical dependency (pool ping, workers.AllHealthy); liveness stays a trivial 200"}
			}
			return Result{Pass: true, Detail: fmt.Sprintf("%d probes registered", readyChecks)}
		},
	}
}
