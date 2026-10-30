package webx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeSiteverify is the httptest double for the Cloudflare siteverify
// endpoint: it records every call's wire form and replies with the
// configured body/status.
type fakeSiteverify struct {
	mu     sync.Mutex
	hits   int
	method string
	ctype  string
	form   map[string]string
}

func (f *fakeSiteverify) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits
}

func (f *fakeSiteverify) recorded() (method, ctype string, form map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.method, f.ctype, f.form
}

func (f *fakeSiteverify) handler(body string, status int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.mu.Lock()
		f.hits++
		f.method = r.Method
		f.ctype = r.Header.Get("Content-Type")
		f.form = map[string]string{}
		for k, v := range r.PostForm {
			f.form[k] = v[0]
		}
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

// serveFake spins the fake endpoint up and points a guard at it. Tests that
// need a custom logger or TTL build via newTurnstileMiddleware directly.
func serveFake(t *testing.T, cfg func() TurnstileConfig, body string, status int) (func(http.Handler) http.Handler, *fakeSiteverify) {
	t.Helper()
	fake := &fakeSiteverify{}
	srv := httptest.NewServer(fake.handler(body, status))
	t.Cleanup(srv.Close)
	return newTurnstileMiddleware(cfg, nil, nil, srv.URL, turnstileConfigTTL), fake
}

const turnstileOKBody = `{"success":true}`
const turnstileFailBody = `{"success":false,"error-codes":["invalid-input-response","timeout-or-duplicate"]}`

func enabledCfg() TurnstileConfig {
	return TurnstileConfig{SiteKey: "1x00000000000000000000AA", SecretKey: "1x0000000000000000000000000000000AA"}
}

func turnstileRequest(h func(http.Handler) http.Handler, token string, prepare func(*http.Request)) *httptest.ResponseRecorder {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	r := httptest.NewRequest(http.MethodPost, "/auth/register", nil)
	r.RemoteAddr = "192.0.2.1:1234"
	if token != "" {
		r.Header.Set(HeaderTurnstileToken, token)
	}
	if prepare != nil {
		prepare(r)
	}
	w := httptest.NewRecorder()
	h(next).ServeHTTP(w, r)
	return w
}

// Matrix 1: unconfigured pair = pure passthrough — no token needed, and the
// siteverify endpoint is never dialed (zero overhead floor for products
// that never opt in).
func TestTurnstile_DisabledPassthroughZeroCalls(t *testing.T) {
	h, fake := serveFake(t, func() TurnstileConfig { return TurnstileConfig{} },
		turnstileOKBody, http.StatusOK)
	w := turnstileRequest(h, "", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ok", w.Body.String())
	assert.Zero(t, fake.count())

	// Half-configured pairs are equally disabled (site key alone / secret
	// alone must not half-enforce).
	for _, cfg := range []func() TurnstileConfig{
		func() TurnstileConfig { return TurnstileConfig{SiteKey: "1x00000000000000000000AA"} },
		func() TurnstileConfig { return TurnstileConfig{SecretKey: "1x0000000000000000000000000000000AA"} },
	} {
		h, fake := serveFake(t, cfg, turnstileOKBody, http.StatusOK)
		w := turnstileRequest(h, "", nil)
		assert.Equal(t, http.StatusOK, w.Code, "half-configured pair must stay disabled")
		assert.Zero(t, fake.count())
	}
}

// Matrix 2: enabled + token + success:true verdict → the request passes and
// siteverify was dialed exactly once.
func TestTurnstile_ValidTokenPasses(t *testing.T) {
	h, fake := serveFake(t, enabledCfg, turnstileOKBody, http.StatusOK)
	w := turnstileRequest(h, "tok-123", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ok", w.Body.String())
	assert.Equal(t, 1, fake.count())
}

// Matrix 3: explicit success:false → 400 E_TURNSTILE (fail-closed on the
// verdict); an explicit verdict is NOT a transport failure, so no log.Error.
func TestTurnstile_VerdictFailRejected(t *testing.T) {
	var errLogged bool
	fake := &fakeSiteverify{}
	srv := httptest.NewServer(fake.handler(turnstileFailBody, http.StatusOK))
	defer srv.Close()

	h := newTurnstileMiddleware(enabledCfg, nil, captureLogger(&errLogged), srv.URL, turnstileConfigTTL)
	w := turnstileRequest(h, "tok-replayed", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	var body ErrorBody
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "E_TURNSTILE", body.Code)
	assert.False(t, errLogged, "explicit verdict is not a transport failure — no log.Error")
}

// Matrix 4: enabled + missing/blank token header → 400 without dialing
// siteverify (no candidate to verify).
func TestTurnstile_MissingTokenRejected(t *testing.T) {
	h, fake := serveFake(t, enabledCfg, turnstileOKBody, http.StatusOK)
	for _, token := range []string{"", "   "} {
		w := turnstileRequest(h, token, nil)
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "E_TURNSTILE")
	}
	assert.Zero(t, fake.count(), "missing token must not hit siteverify")
}

// Matrix 5: endpoint unreachable (connection refused) → fail open, and the
// bypass window is on the record at error level.
func TestTurnstile_EndpointUnreachableFailsOpen(t *testing.T) {
	srv := httptest.NewServer((&fakeSiteverify{}).handler(turnstileOKBody, http.StatusOK))
	srv.Close() // its port now refuses connections

	var errLogged bool
	h := newTurnstileMiddleware(enabledCfg, nil, captureLogger(&errLogged), srv.URL, turnstileConfigTTL)
	w := turnstileRequest(h, "tok-any", nil)
	assert.Equal(t, http.StatusOK, w.Code, "transport failure must fail open")
	assert.Equal(t, "ok", w.Body.String())
	assert.True(t, errLogged, "fail-open must log.Error the bypassable window")
}

// Matrix 6: 200-but-not-JSON body → fail open + log.Error (same transport
// class: no verdict could be obtained).
func TestTurnstile_NonJSONResponseFailsOpen(t *testing.T) {
	var errLogged bool
	fake := &fakeSiteverify{}
	srv := httptest.NewServer(fake.handler("<html>gateway error</html>", http.StatusOK))
	defer srv.Close()

	h := newTurnstileMiddleware(enabledCfg, nil, captureLogger(&errLogged), srv.URL, turnstileConfigTTL)
	w := turnstileRequest(h, "tok-any", nil)
	assert.Equal(t, http.StatusOK, w.Code, "unparseable verdict must fail open")
	assert.True(t, errLogged)
}

// Companion to 5/6: a non-200 siteverify status is a CF-side incident, not a
// bot verdict — same fail-open branch.
func TestTurnstile_Non200StatusFailsOpen(t *testing.T) {
	var errLogged bool
	fake := &fakeSiteverify{}
	srv := httptest.NewServer(fake.handler("boom", http.StatusBadGateway))
	defer srv.Close()

	h := newTurnstileMiddleware(enabledCfg, nil, captureLogger(&errLogged), srv.URL, turnstileConfigTTL)
	w := turnstileRequest(h, "tok-any", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.True(t, errLogged)
}

// Matrix 7: the provider is re-read only after the TTL expires — enablement
// flips (empty → configured) become visible on the next window, not sooner.
func TestTurnstile_ConfigFlipVisibleAfterTTL(t *testing.T) {
	const ttl = 250 * time.Millisecond
	enabled := false
	cfg := func() TurnstileConfig {
		if !enabled {
			return TurnstileConfig{}
		}
		return enabledCfg()
	}
	fake := &fakeSiteverify{}
	srv := httptest.NewServer(fake.handler(turnstileOKBody, http.StatusOK))
	defer srv.Close()

	h := newTurnstileMiddleware(cfg, nil, nil, srv.URL, ttl)

	// Window 1: disabled → token-less request passes.
	w := turnstileRequest(h, "", nil)
	assert.Equal(t, http.StatusOK, w.Code, "disabled state must passthrough")

	// Still window 1: the freshly cached disabled pair must win.
	enabled = true
	w = turnstileRequest(h, "", nil)
	assert.Equal(t, http.StatusOK, w.Code, "cached config must survive until the TTL expires")

	// Window 2 (after expiry): the same token-less request is now rejected.
	time.Sleep(ttl + 50*time.Millisecond)
	w = turnstileRequest(h, "", nil)
	assert.Equal(t, http.StatusBadRequest, w.Code, "expired cache must re-read the now-enabled pair")
	assert.Contains(t, w.Body.String(), "E_TURNSTILE")
}

// Matrix 8: remoteip prefers the ClientMetadata-resolved address from ctx,
// falling back to bare RemoteAddr; plus the wire-format contract (POST,
// form encoding, secret/response passthrough).
func TestTurnstile_RemoteIPAndWireContract(t *testing.T) {
	h, fake := serveFake(t, func() TurnstileConfig {
		return TurnstileConfig{SiteKey: "site", SecretKey: "secret-1"}
	}, turnstileOKBody, http.StatusOK)

	// ctx IP wins over the request's RemoteAddr.
	w := turnstileRequest(h, "tok-ctx", func(r *http.Request) {
		*r = *r.WithContext(WithClientIP(r.Context(), "203.0.113.7"))
	})
	require.Equal(t, http.StatusOK, w.Code)
	method, ctype, form := fake.recorded()
	assert.Equal(t, http.MethodPost, method)
	assert.Equal(t, "application/x-www-form-urlencoded", ctype)
	assert.Equal(t, "secret-1", form["secret"])
	assert.Equal(t, "tok-ctx", form["response"])
	assert.Equal(t, "203.0.113.7", form["remoteip"], "ClientMetadata ctx IP must take precedence")

	// No ctx IP → bare ClientIP(r) (RemoteAddr host, no proxy trust).
	w = turnstileRequest(h, "tok-bare", nil)
	require.Equal(t, http.StatusOK, w.Code)
	_, _, form = fake.recorded()
	assert.Equal(t, "192.0.2.1", form["remoteip"], "fallback must be the request's RemoteAddr host")
}

// The exported constructor must survive nil cfg / nil hc / nil log (defaults
// kick in) and stay a passthrough for the absent capability.
func TestTurnstile_NilArgumentsSafe(t *testing.T) {
	h := Turnstile(nil, nil, nil)
	w := turnstileRequest(h, "", nil)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ok", w.Body.String())
}
