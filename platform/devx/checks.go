package devx

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
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

// rlsMaxProbes caps how many FORCE-RLS tables the probe reads; a database with
// more than this many protected tables still fails correctly on the first
// visible one, the cap only bounds probe latency at boot.
const rlsMaxProbes = 10

// RLSCheck is the boot-time guardrail tying "RLS-enabled tables" to "the query
// path sets the tenant GUCs". It probes behavior, not policy text: it checks
// the connection's role first (SUPERUSER or BYPASSRLS makes every policy dead
// code — the shape behind "worked for years on the old machine", then 42501
// the day a fresh machine deployed a non-bypass role), then reads each
// ENABLE+FORCE RLS table without tenant context. A GUC-based policy fails that
// read (fail-closed); rows coming back mean the policy does not reference the
// session variable or is permissive, and the RLS layer is dead weight on this
// role.
//
// Honest limits: passing proves the tables deny anonymous reads to THIS role,
// not that the policies are tenant-correct (a policy keyed to the wrong GUC,
// or a permissive OR-ed branch, can still pass); an errored probe is counted
// as protected because the row stayed invisible, without distinguishing RLS
// rejection from any other error. conn is a plain *sql.DB — devx does not
// depend on pgx here, so any driver works. Pass the same connection the
// application queries through; a check against the admin role proves nothing.
func RLSCheck(conn *sql.DB) Check {
	return Check{
		Name:    "rls_guardrail",
		Summary: "RLS-enabled tables actually reject reads without tenant context on this connection's role",
		Run: func(ctx context.Context) Result {
			// Step 1: the role must not bypass RLS, or every policy below is
			// unreachable and the probe would be theater.
			var role string
			var roleSuper, roleBypass bool
			err := conn.QueryRowContext(ctx,
				`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`).Scan(&role, &roleSuper, &roleBypass)
			if err != nil {
				return Result{Pass: false, Detail: "cannot inspect the connection role: " + err.Error(), FixHint: "check the database connection; the check needs SELECT on pg_roles"}
			}
			if roleSuper || roleBypass {
				return Result{
					Pass:    false,
					Detail:  fmt.Sprintf("connection role %q is superuser or BYPASSRLS: the app connection role bypasses RLS entirely; every RLS policy is dead code and tenant isolation rests on SQL WHERE alone", role),
					FixHint: "connect the app as a NOSUPERUSER NOBYPASSRLS role and route queries through pg.WithTenant",
				}
			}

			// Step 2: find the tables that demand tenant context (FORCE RLS).
			rows, err := conn.QueryContext(ctx, `SELECT n.nspname, c.relname
				FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE c.relrowsecurity AND c.relforcerowsecurity
				  AND c.relkind = 'r'
				  AND n.nspname NOT IN ('pg_catalog','information_schema')`)
			if err != nil {
				return Result{Pass: false, Detail: "cannot enumerate FORCE RLS tables: " + err.Error(), FixHint: "the check needs SELECT on pg_class/pg_namespace"}
			}
			type table struct{ schema, name string }
			var tables []table
			for rows.Next() {
				var t table
				if err := rows.Scan(&t.schema, &t.name); err != nil {
					rows.Close()
					return Result{Pass: false, Detail: "cannot read FORCE RLS table list: " + err.Error()}
				}
				tables = append(tables, t)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return Result{Pass: false, Detail: "cannot read FORCE RLS table list: " + err.Error()}
			}
			if len(tables) == 0 {
				return Result{Pass: true, Detail: "no FORCE RLS tables (RLS guardrail not applicable)"}
			}

			// Step 3: probe each table as-is, with no tenant GUCs set. An
			// error (typically 42501) is the good outcome: the row stayed
			// invisible. Rows coming back is the incident shape.
			var visible, probed []string
			for _, t := range tables[:min(len(tables), rlsMaxProbes)] {
				probed = append(probed, t.schema+"."+t.name)
				var exists bool
				probe := fmt.Sprintf(`SELECT EXISTS (SELECT 1 FROM %s.%s)`, quoteIdent(t.schema), quoteIdent(t.name))
				switch err := conn.QueryRowContext(ctx, probe).Scan(&exists); {
				case err != nil:
					// Properly protected: the query dies without tenant context.
				case exists:
					visible = append(visible, t.schema+"."+t.name)
				}
				// exists == false: fail-closed policy, protected.
			}
			if len(visible) > 0 {
				return Result{
					Pass:   false,
					Detail: fmt.Sprintf("FORCE-RLS table(s) %v return rows to a non-bypass role with no tenant context: the policy does not reference the tenant session variables or is permissive; the RLS layer is dead weight and a live 42501 mine on role changes", visible),
					FixHint: "write each policy against current_setting('app.workspace_id', true) / 'app.user_id' and query these tables only through pg.WithTenant / pg.TenantExec / pg.TenantScan",
				}
			}
			return Result{Pass: true, Detail: fmt.Sprintf("%d/%d FORCE-RLS table(s) probed, all deny reads without tenant context: %v", len(probed), len(tables), probed)}
		},
	}
}

// quoteIdent defends the probe's %-spliced identifier: table and schema names
// come from the catalog itself, but the probe rejects anything outside plain
// identifier characters rather than trusting that. Returns the double-quoted
// form either way (validated names need no escaping; anything else gets the
// standard quote-doubling).
func quoteIdent(s string) string {
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
		}
	}
	return `"` + s + `"`
}
