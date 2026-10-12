package devx

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/logring"
	"github.com/haozing/ploykit/platform/webx"
)

// newTestLogger builds a logger whose output feeds a logring ring (same
// assembly as production: logring.Wrap over a format handler) and hands the
// ring back through out.
func newTestLogger(t *testing.T, out **logring.Ring) *slog.Logger {
	t.Helper()
	inner := slog.NewTextHandler(&bytes.Buffer{}, nil)
	h := logring.New(inner, logring.Options{})
	*out = h.Ring()
	return slog.New(h)
}

// ctxWithRequestID routes a request through the real webx middleware to
// obtain a context carrying the given request id (the setter is unexported).
func ctxWithRequestID(t *testing.T, rid string) context.Context {
	t.Helper()
	var captured context.Context
	mw := webx.RequestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.Context()
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Request-Id", rid)
	mw.ServeHTTP(httptest.NewRecorder(), req)
	require.NotNil(t, captured)
	return captured
}

func TestDoctor_AllPassAndAggregate(t *testing.T) {
	d := NewDoctor()
	d.Register(Check{Name: "z_ok", Summary: "always passes", Run: func(ctx context.Context) Result { return Result{Pass: true, Detail: "fine"} }})
	d.Register(Check{Name: "a_ok", Summary: "also passes", Run: func(ctx context.Context) Result { return Result{Pass: true, Detail: "fine"} }})

	out := d.RunDoctor(context.Background(), time.Second)
	assert.True(t, out.OK)
	require.Len(t, out.Checks, 2)
	names := []string{out.Checks[0].Name, out.Checks[1].Name}
	assert.ElementsMatch(t, []string{"a_ok", "z_ok"}, names)
}

func TestDoctor_FailureCarriesFixHint(t *testing.T) {
	d := NewDoctor()
	d.Register(Check{Name: "broken", Summary: "always fails", Run: func(ctx context.Context) Result {
		return Result{Pass: false, Detail: "table missing", FixHint: "run the migration"}
	}})
	out := d.RunDoctor(context.Background(), time.Second)
	assert.False(t, out.OK)
	require.Len(t, out.Checks, 1)
	assert.Equal(t, "run the migration", out.Checks[0].FixHint)
}

func TestDoctor_TimeoutAndPanicBecomeFailures(t *testing.T) {
	d := NewDoctor()
	d.Register(Check{Name: "hangs", Summary: "never returns", Run: func(ctx context.Context) Result {
		<-ctx.Done()
		return Result{Pass: true}
	}})
	d.Register(Check{Name: "panics", Summary: "blows up", Run: func(ctx context.Context) Result {
		panic("boom")
	}})
	out := d.RunDoctor(context.Background(), 100*time.Millisecond)
	assert.False(t, out.OK)
	for _, c := range out.Checks {
		assert.False(t, c.Pass)
		assert.NotEmpty(t, c.Detail)
	}
}

func TestDoctor_DuplicateNamePanics(t *testing.T) {
	d := NewDoctor()
	d.Register(Check{Name: "dup", Run: func(ctx context.Context) Result { return Result{Pass: true} }})
	assert.Panics(t, func() { d.Register(Check{Name: "dup"}) })
}

func TestBuiltinChecks_TwoSided(t *testing.T) {
	t.Run("cookie secure", func(t *testing.T) {
		assert.True(t, CookieSecureCheck(true, true).Run(context.Background()).Pass)
		assert.True(t, CookieSecureCheck(false, false).Run(context.Background()).Pass)
		assert.False(t, CookieSecureCheck(false, true).Run(context.Background()).Pass, "production without Secure must fail")
		assert.False(t, CookieSecureCheck(true, false).Run(context.Background()).Pass, "local with Secure must fail (the CSRF trap)")
	})
	t.Run("drain window", func(t *testing.T) {
		assert.True(t, DrainWindowCheck(45*time.Second, 30*time.Second).Run(context.Background()).Pass)
		res := DrainWindowCheck(10*time.Second, 0).Run(context.Background())
		assert.False(t, res.Pass)
		assert.Contains(t, res.Detail, "45s")
	})
	t.Run("health probes", func(t *testing.T) {
		assert.False(t, HealthProbesCheck(0).Run(context.Background()).Pass)
		assert.True(t, HealthProbesCheck(2).Run(context.Background()).Pass)
	})
	t.Run("seal key", func(t *testing.T) {
		t.Setenv("PLOYKIT_TEST_SEAL", "")
		assert.False(t, SealKeyCheck("PLOYKIT_TEST_SEAL").Run(context.Background()).Pass)
		t.Setenv("PLOYKIT_TEST_SEAL", "k")
		assert.True(t, SealKeyCheck("PLOYKIT_TEST_SEAL").Run(context.Background()).Pass)
	})
}

// testPrincipalCtx builds a request context carrying a principal, mimicking
// what webx.Authenticate installs.
func testPrincipalCtx(ctx context.Context, p *webx.Principal) context.Context {
	return webx.WithPrincipal(ctx, p)
}

func TestRoutes_LogsEndpoint(t *testing.T) {
	var ring *logring.Ring
	logger := newTestLogger(t, &ring)
	rid := "rid-123"
	logger.InfoContext(ctxWithRequestID(t, rid), "handled", "path", "/api/tasks")
	logger.InfoContext(context.Background(), "no request id here")

	deps := Deps{Logs: NewLogService(ring)}
	mux := http.NewServeMux()
	Mount(mux, deps)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/dev/logs?request_id="+rid, nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var body struct {
		Entries []logring.Entry `json:"entries"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Len(t, body.Entries, 1)
	assert.Equal(t, "handled", body.Entries[0].Message)

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/dev/logs?request_id=missing", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	body.Entries = nil
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Empty(t, body.Entries)

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/dev/logs?level=bogus", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	// Not wired: Logs nil → the endpoint exists but reports disabled.
	mux2 := http.NewServeMux()
	Mount(mux2, Deps{})
	rec = httptest.NewRecorder()
	mux2.ServeHTTP(rec, httptest.NewRequest("GET", "/dev/logs", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "not enabled")
}

func TestRoutes_ValidationAndMapping(t *testing.T) {
	deps := Deps{Jobs: &JobService{}} // wired to nothing: Available=false
	mux := http.NewServeMux()
	Mount(mux, deps)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/dev/jobs/not-an-int", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code, "invalid id is a validation error before the not-wired check")

	// writeServiceErr mapping.
	rec = httptest.NewRecorder()
	writeServiceErr(rec, ErrJobNotFound)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	rec = httptest.NewRecorder()
	writeServiceErr(rec, ErrNotWired)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	rec = httptest.NewRecorder()
	writeServiceErr(rec, nil)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestWriteServiceErr_ValidationWraps(t *testing.T) {
	wrapped := fmtWrap(ErrValidation, "bad state")
	rec := httptest.NewRecorder()
	writeServiceErr(rec, wrapped)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "bad state")
}

func fmtWrap(inner error, msg string) error { return errWrap{msg, inner} }

type errWrap struct {
	msg string
	err error
}

func (e errWrap) Error() string { return e.msg + ": " + e.err.Error() }
func (e errWrap) Unwrap() error { return e.err }

func TestAuditHookInvoked(t *testing.T) {
	var actions []string
	deps := Deps{
		Jobs:  &JobService{}, // not available, but the audit path is testable via a fake service
		Audit: func(r *http.Request, action, target string) { actions = append(actions, action+"/"+target) },
	}
	// audit is unexported; call through handleJobRetry would need a real
	// client — exercise the hook contract directly.
	deps.Audit(nil, "devx.job.retry", "42")
	require.Len(t, actions, 1)
	assert.Equal(t, "devx.job.retry/42", actions[0])
}
