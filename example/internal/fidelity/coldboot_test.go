// Package fidelity hosts the cold-boot production-fidelity e2e lane: the real
// example application binary (compiled from ./cmd/app) boots as a subprocess
// against a FRESH database — one this test creates on the TEST_DATABASE_URL
// server, migrates itself, and drops on cleanup — and serves real HTTP flows.
// No warm state anywhere: no shared dev database, no seeded tenant, no prior
// migrations.
//
// THE GATE (the whole lesson of this file): before ANY HTTP call, the test
// polls the app's captured log for the "listening" line naming OUR OWN addr.
// A port collision with another developer's app once produced a green e2e run
// that had actually been exercising a stranger's server. The gate is not an
// optimization — it is the correctness precondition for every assertion below.
//
// Convention: skip unless TEST_DATABASE_URL points at a disposable postgres
// (any running instance; in CI a postgres service container). This test never
// assumes docker.
package fidelity

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/pgmigrate"
)

const (
	// fidelityDBName is the dedicated database this lane owns on the
	// TEST_DATABASE_URL server. Fixed name: drop-if-exists makes reruns
	// idempotent, and a second concurrent run against the same server is a
	// self-inflicted wound this lane refuses to hide.
	fidelityDBName = "fidelity_e2e"

	// gateTimeout bounds the wait for the "listening addr=<ours>" log line.
	gateTimeout = 60 * time.Second

	// bootLogTail is how much of the captured app log a failure report keeps.
	bootLogTail = 8 << 10
)

func TestColdBootProductionFidelity(t *testing.T) {
	baseDSN := os.Getenv("TEST_DATABASE_URL")
	if baseDSN == "" {
		t.Skip("TEST_DATABASE_URL not set; cold-boot e2e needs a disposable postgres (see package comment)")
	}
	ctx := context.Background()
	exampleRoot := exampleModuleRoot(t)

	// ---- 1. Own database: create it fresh, migrate it serially HERE. ----
	// Other DB-gated harnesses assume warm databases; a fresh DB plus
	// concurrent migration runners race. This lane bootstraps its own
	// database and applies every migration serially before the app boots,
	// so the app's own migrate calls at boot are verifiable no-ops.
	fidelityDSN, admin := createFidelityDB(t, baseDSN)
	t.Cleanup(func() {
		dropCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, _ = admin.Exec(dropCtx, "DROP DATABASE "+fidelityDBName+" WITH (FORCE)")
		admin.Close()
	})

	pool, err := pgxpool.New(ctx, fidelityDSN)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."), "framework migration chain 001-999")
	require.NoError(t, applyProductMigrations(ctx, pool), "product migration chain 1001+")

	// ---- 2. Build the real app binary once. ----
	buildStart := time.Now()
	binPath := filepath.Join(t.TempDir(), "fidelity-app"+exeSuffix())
	buildCtx, cancelBuild := context.WithTimeout(ctx, 5*time.Minute)
	defer cancelBuild()
	build := exec.CommandContext(buildCtx, "go", "build", "-o", binPath, "./cmd/app")
	build.Dir = exampleRoot
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build ./cmd/app failed: %v\n%s", err, tailBytes(out, bootLogTail))
	}
	t.Logf("flow: fresh db %s migrated; app built in %s", fidelityDBName, time.Since(buildStart))

	// ---- 3. Boot the subprocess on a dynamic port. ----
	listenAddr := freeLoopbackAddr(t)
	appLog := &syncBuffer{}
	cmd := exec.Command(binPath)
	cmd.Dir = exampleRoot // same cwd the dev flow uses; renderx looks for the frontend relative to it
	cmd.Env = append(os.Environ(),
		"DATABASE_URL="+fidelityDSN,
		"AUTH_SECRET=e2e-fidelity",
		"DEV_CODE=000000",
		"ADDR="+listenAddr,
		"LOG_FORMAT=text", // deterministic log rendering — the gate matches text below
	)
	cmd.Stdout = appLog
	cmd.Stderr = appLog
	require.NoError(t, cmd.Start())

	// Registered AFTER the DB-drop cleanup above, so LIFO order is:
	// kill app -> (close pools) -> drop database. The app must be dead
	// before the drop or it holds connections into the dropping backend.
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait() // "signal: killed" is the expected exit, ignore it
	})

	// ---- 4. THE GATE: no HTTP before the app's own log names our addr. ----
	// We bound nothing: the app listens where we told it. If the port was
	// stolen between our free-port probe and the app's bind, the gate times
	// out (or the log shows the serve error) and we fail loudly WITH the
	// buffered log — never assert against whatever else is on that port.
	wantAddr := "addr=" + listenAddr
	gateDeadline := time.Now().Add(gateTimeout)
	for {
		log := appLog.String()
		if strings.Contains(log, "listening") && strings.Contains(log, wantAddr) {
			break
		}
		if time.Now().After(gateDeadline) {
			t.Fatalf("app did not log listening with %s within %s — refusing to send HTTP to an unverified listener\napp log:\n%s",
				wantAddr, gateTimeout, tailString(log, bootLogTail))
		}
		time.Sleep(200 * time.Millisecond)
	}

	baseURL := "http://" + listenAddr
	t.Logf("flow: gate passed — app logged listening on %s %s after start", listenAddr, time.Since(buildStart))
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	client := &http.Client{Jar: jar, Timeout: 15 * time.Second}

	// ---- 5. Real HTTP flows. ----
	// healthz first. main.go logs "listening" before ListenAndServe binds,
	// so tolerate a brief connection-refused window after the gate — the
	// gate still guarantees we are talking to OUR addr, not a stranger's.
	var healthStatus int
	healthDeadline := time.Now().Add(10 * time.Second)
	for {
		status, _ := doRequest(t, client, http.MethodGet, baseURL+"/healthz", nil, nil)
		if status == http.StatusOK {
			healthStatus = status
			break
		}
		if time.Now().After(healthDeadline) {
			t.Fatalf("/healthz never returned 200 after the listening gate (last status %d)\napp log:\n%s",
				status, tailString(appLog.String(), bootLogTail))
		}
		time.Sleep(200 * time.Millisecond)
	}
	require.Equal(t, http.StatusOK, healthStatus)

	status, body := doRequest(t, client, http.MethodGet, baseURL+"/config", nil, nil)
	require.Equal(t, http.StatusOK, status, "/config body: %s", body)
	var cfg struct {
		CSRFToken string `json:"csrf_token"`
	}
	require.NoError(t, json.Unmarshal(body, &cfg), "/config body: %s", body)
	require.NotEmpty(t, cfg.CSRFToken, "csrf_token must be minted through the real CSRF middleware chain")
	u, err := url.Parse(baseURL)
	require.NoError(t, err)
	require.NotNil(t, jar.Cookies(u), "/config must have stored cookies in the jar (ploykit_csrf)")

	// POST /auth/register through the real cookie+CSRF handshake.
	email := fmt.Sprintf("fidelity-%d@test.local", time.Now().UnixNano())
	regBody, err := json.Marshal(map[string]string{
		"email":        email,
		"password":     "Fidelity!2026e2e", // 10+ chars, 4 character kinds
		"display_name": "Cold Boot Fidelity",
	})
	require.NoError(t, err)
	status, body = doRequest(t, client, http.MethodPost, baseURL+"/auth/register", regBody, map[string]string{
		"Content-Type": "application/json",
		"X-CSRF-Token": cfg.CSRFToken,
	})
	require.Equal(t, http.StatusOK, status, "register body: %s", body)
	var reg struct {
		Registered          bool `json:"registered"`
		ProvisioningPending bool `json:"provisioning_pending"`
		User                struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	require.NoError(t, json.Unmarshal(body, &reg), "register body: %s", body)
	require.True(t, reg.Registered, "register must report registered:true — body: %s", body)
	require.False(t, reg.ProvisioningPending, "ADR 0016 provisioning must have converged in-request — body: %s", body)
	require.NotEmpty(t, reg.User.ID, "register response carries the new user")
	t.Logf("flow: healthz 200, config csrf ok, registered %s (user %s) — provisioning converged", email, reg.User.ID)

	// ---- 6. DB-side proof that provisioning really happened. ----
	// AfterRegister runs post-commit inside the register request, so the
	// rows exist once the 200 is back; the Eventually is a courtesy for any
	// future async variant, not an excuse to weaken the assertions.
	userID := reg.User.ID
	var wsID string
	require.Eventually(t, func() bool {
		return pool.QueryRow(ctx,
			`SELECT id FROM workspace WHERE created_by = $1 AND kind = 'personal'`, userID).
			Scan(&wsID) == nil
	}, 10*time.Second, 250*time.Millisecond, "exactly one personal workspace must be provisioned for %s", email)

	var n int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM workspace WHERE created_by = $1 AND kind = 'personal'`, userID).Scan(&n))
	require.Equal(t, 1, n, "exactly one personal workspace")

	require.NoError(t, pool.QueryRow(ctx, `
		SELECT count(*) FROM member m JOIN workspace w ON w.id = m.workspace_id
		WHERE w.id = $1 AND m.user_id = $2 AND m.role = 'owner' AND m.removed_at IS NULL`,
		wsID, userID).Scan(&n))
	require.Equal(t, 1, n, "owner membership row")

	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM quota_grant WHERE workspace_id = $1 AND ref_id = $2`,
		wsID, wsID+":tasks_monthly").Scan(&n))
	require.GreaterOrEqual(t, n, 1, "onboarding quota credits with ref_id <wsID>:tasks_monthly")

	// ---- 7. Readiness: real dependency probes (db ping + workers), not a hand-rolled 200. ----
	status, body = doRequest(t, client, http.MethodGet, baseURL+"/readyz", nil, nil)
	require.Equal(t, http.StatusOK, status, "readyz body: %s", body)
	t.Logf("flow: db rows verified (workspace/member/quota_grant), readyz 200 — cold-boot lane complete")
}

// createFidelityDB connects to the TEST_DATABASE_URL server (whatever
// database the URL names — only the server coordinates matter), recreates the
// dedicated fidelity database from scratch, and returns its DSN. The drop
// pool uses simple exec mode: CREATE/DROP DATABASE are transaction-block
// sensitive and multi-purpose pools are the wrong tool.
func createFidelityDB(t *testing.T, baseDSN string) (fidelityDSN string, admin *pgxpool.Pool) {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(baseDSN)
	require.NoError(t, err, "TEST_DATABASE_URL must be a valid DSN")
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	cfg.MaxConns = 2
	admin, err = pgxpool.NewWithConfig(context.Background(), cfg)
	require.NoError(t, err)
	fidelityDSN = withDatabaseName(t, baseDSN, fidelityDBName)

	// Drop-if-exists makes reruns idempotent; IF EXISTS never errors on a
	// virgin server (NOTICE only), so a real failure here (permissions,
	// pre-PG13 server without FORCE) surfaces at CREATE below as 42P04.
	dropCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _ = admin.Exec(dropCtx, "DROP DATABASE IF EXISTS "+fidelityDBName+" WITH (FORCE)")
	ctCtx, cancelCreate := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelCreate()
	_, err = admin.Exec(ctCtx, "CREATE DATABASE "+fidelityDBName)
	require.NoError(t, err, "create %s on the TEST_DATABASE_URL server", fidelityDBName)
	return fidelityDSN, admin
}

// withDatabaseName rewrites a DSN to name a different database on the same
// server, preserving every other component (host/port/user/password/sslmode).
// Both the URL form and the libpq keyword form are handled.
func withDatabaseName(t *testing.T, dsn, db string) string {
	t.Helper()
	if strings.Contains(dsn, "://") {
		u, err := url.Parse(dsn)
		require.NoError(t, err, "TEST_DATABASE_URL looks like a URL but does not parse")
		u.Path = "/" + db
		return u.String()
	}
	kv := regexp.MustCompile(`\b(?:database|dbname)=\S+`)
	if kv.MatchString(dsn) {
		return kv.ReplaceAllString(dsn, "dbname="+db)
	}
	return dsn + " dbname=" + db
}

// applyProductMigrations applies example's own 1001+ chain from
// ../../cmd/app/migrations, mirroring the pattern proven in
// internal/task/rls_test.go (the framework chain has already created
// schema_migrations via pgmigrate.Up).
var prodMigrationRe = regexp.MustCompile(`^(\d{3,})_[a-z0-9_]+\.up\.sql$`)

func applyProductMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	const dir = "../../cmd/app/migrations"
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read %s: %w", dir, err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && prodMigrationRe.MatchString(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names) // lexicographic == numeric here: the 3-4 digit version prefix is zero-padded
	for _, name := range names {
		version := prodMigrationRe.FindStringSubmatch(name)[1]
		var applied bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		script := fmt.Sprintf("BEGIN;\n%s\nINSERT INTO schema_migrations(version) VALUES ('%s');\nCOMMIT;", string(body), version)
		conn, err := pool.Acquire(ctx)
		if err != nil {
			return err
		}
		_, execErr := conn.Conn().PgConn().Exec(ctx, script).ReadAll()
		conn.Release()
		if execErr != nil {
			return fmt.Errorf("apply %s: %w", name, execErr)
		}
	}
	return nil
}

// exampleModuleRoot resolves the example module root from this file's
// location (<root>/example/internal/fidelity), so the test works from any
// working directory.
func exampleModuleRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok, "runtime.Caller failed")
	return filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", ".."))
}

func freeLoopbackAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := l.Addr().String()
	require.NoError(t, l.Close()) // small race between close and the app's bind is accepted
	return addr
}

func exeSuffix() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

// doRequest is the plain net/http round trip: cookie jar transparent, extra
// headers for the CSRF handshake, response body always drained for reuse.
func doRequest(t *testing.T, client *http.Client, method, rawURL string, body []byte, headers map[string]string) (int, []byte) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, rawURL, rdr)
	require.NoError(t, err)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, respBody
}

// syncBuffer is a concurrency-safe buffer: the app logs from several
// goroutines, and the gate polls the buffer while stderr drains.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func tailString(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "...(truncated)\n" + s[len(s)-n:]
}

func tailBytes(b []byte, n int) []byte {
	if len(b) <= n {
		return b
	}
	return b[len(b)-n:]
}
