package webx

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HeaderTurnstileToken carries the Turnstile widget's one-time token from the
// browser to the guarded endpoint. A header (not a form/JSON field) so the
// middleware never competes with the handler for the request body — every
// route it guards parses a JSON body of its own.
const HeaderTurnstileToken = "X-Turnstile-Token"

// TurnstileConfig is the enablement pair for the Turnstile middleware. BOTH
// keys non-empty = enabled; either one empty = disabled — the widget cannot
// render without the site key and siteverify cannot run without the secret,
// so a half-configured pair must degrade to fully-off, never half-enforced.
// The framework takes this via a provider function (not a struct value)
// because the configuration source is product territory (settings store,
// env, ...); injection, not lookup — the same family as ClientMetadata's
// trustedProxies.
type TurnstileConfig struct {
	SiteKey   string
	SecretKey string
}

const (
	// turnstileVerifyURL is Cloudflare's siteverify endpoint.
	turnstileVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

	// turnstileConfigTTL bounds how long one provider read is trusted: a
	// per-mount cache keeps the hot path at one mutex acquisition instead of
	// a settings read, while admin-console changes still land within 30s —
	// the same TTL product-side config injectors use.
	turnstileConfigTTL = 30 * time.Second

	// turnstileVerifyTimeout bounds one siteverify round trip. The guarded
	// routes are entry points (register / send-code / password reset): a
	// hanging CF call must not hold the request open, and its budget must
	// stay well inside any outer request-timeout middleware.
	turnstileVerifyTimeout = 3 * time.Second
)

// Turnstile returns the human-verification middleware (Cloudflare Turnstile).
// cfg is consulted at most once per 30s and may flip over time (nil cfg =
// the capability is permanently absent); hc nil = a default client with a 3s
// timeout; log nil = slog.Default(). While disabled the middleware is a
// straight passthrough — products that never configure Turnstile must not
// observe any difference.
//
// Failure posture — fail-closed on the VERDICT, fail-open on TRANSPORT:
//
//   - missing/empty X-Turnstile-Token, or siteverify success=false →
//     400 CodeTurnstile. error_codes are logged at debug; the token itself
//     is never logged (single-use, and it identifies a solve attempt).
//   - transport error / timeout / non-200 / unparseable response → the
//     request proceeds and log.Error fires. Fail-closed here would turn
//     every Cloudflare outage window into "registration and password reset
//     are down site-wide" — an availability incident — while the fail-open
//     exposure is bounded to send-cost on the guarded endpoints, which are
//     already rate-limited per IP. Defense in depth, not a hard gate.
func Turnstile(cfg func() TurnstileConfig, hc *http.Client, log *slog.Logger) func(http.Handler) http.Handler {
	return newTurnstileMiddleware(cfg, hc, log, turnstileVerifyURL, turnstileConfigTTL)
}

// newTurnstileMiddleware is Turnstile with the siteverify endpoint and the
// config-cache TTL injectable — package-internal, so only webx's own tests
// point the middleware at an httptest double; callers always get the real
// endpoint and the documented TTL.
func newTurnstileMiddleware(cfg func() TurnstileConfig, hc *http.Client, log *slog.Logger, endpoint string, ttl time.Duration) func(http.Handler) http.Handler {
	if cfg == nil {
		cfg = func() TurnstileConfig { return TurnstileConfig{} }
	}
	if hc == nil {
		hc = &http.Client{Timeout: turnstileVerifyTimeout}
	}
	if log == nil {
		log = slog.Default()
	}
	m := &turnstileMiddleware{cfg: cfg, endpoint: endpoint, ttl: ttl, hc: hc, log: log}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			conf, enabled := m.current()
			if !enabled {
				next.ServeHTTP(w, r)
				return
			}
			token := strings.TrimSpace(r.Header.Get(HeaderTurnstileToken))
			if token == "" {
				WriteError(w, http.StatusBadRequest, CodeTurnstile,
					"human verification required (missing "+HeaderTurnstileToken+" header)", nil)
				return
			}
			if m.verify(r, conf.SecretKey, token) {
				next.ServeHTTP(w, r)
				return
			}
			WriteError(w, http.StatusBadRequest, CodeTurnstile, "human verification failed", nil)
		})
	}
}

// turnstileMiddleware carries the per-mount state: the provider with its TTL
// cache and the (test-injectable) endpoint.
type turnstileMiddleware struct {
	cfg      func() TurnstileConfig
	endpoint string
	ttl      time.Duration
	hc       *http.Client
	log      *slog.Logger

	mu     sync.Mutex
	pair   TurnstileConfig
	loaded time.Time
}

// current returns the cached config pair and whether the guard is enabled.
// Mutex + pair + loadedAt — the same 30s-TTL hot-read shape products use for
// settings-backed middleware, re-implemented in-framework because dependency
// direction is product → framework, never the reverse.
func (m *turnstileMiddleware) current() (TurnstileConfig, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.loaded.IsZero() || !time.Now().Before(m.loaded.Add(m.ttl)) {
		m.pair = m.cfg()
		m.loaded = time.Now()
	}
	enabled := m.pair.SiteKey != "" && m.pair.SecretKey != ""
	return m.pair, enabled
}

// verify runs one siteverify round trip. Transport-class failures (dial
// error, timeout, non-200, unparseable body) fail OPEN with log.Error — see
// the Turnstile doc comment for the availability rationale; only an explicit
// success=false is a rejection.
func (m *turnstileMiddleware) verify(r *http.Request, secret, token string) bool {
	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	if ip := turnstileRemoteIP(r); ip != "" {
		form.Set("remoteip", ip)
	}
	ctx, cancel := context.WithTimeout(r.Context(), turnstileVerifyTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.endpoint,
		strings.NewReader(form.Encode()))
	if err != nil { // unreachable in practice (fixed-pattern URL); fail open
		m.failOpen(err, "request build")
		return true
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := m.hc.Do(req)
	if err != nil {
		m.failOpen(err, "transport")
		return true
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		m.failOpen(err, "body read")
		return true
	}
	if resp.StatusCode != http.StatusOK {
		m.failOpen(nil, "status "+strconv.Itoa(resp.StatusCode))
		return true
	}
	var verdict struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
	}
	if err := json.Unmarshal(body, &verdict); err != nil {
		m.failOpen(err, "unparseable response")
		return true
	}
	if !verdict.Success {
		// Debug, not warn: an explicit rejection is the expected bot path,
		// not an operational anomaly. No token in the record (see Turnstile).
		m.log.Debug("webx: turnstile challenge rejected",
			"error_codes", verdict.ErrorCodes, "path", r.URL.Path)
		return false
	}
	return true
}

// failOpen logs one transport-class failure. Error level on purpose: every
// line here is a "the guard was bypassable in this window" record an
// operator can alert on.
func (m *turnstileMiddleware) failOpen(err error, stage string) {
	m.log.Error("webx: turnstile siteverify failed, failing open",
		"stage", stage, "err", err)
}

// turnstileRemoteIP resolves the visitor address for siteverify's advisory
// remoteip field. ClientIPFrom first: when the ClientMetadata middleware ran
// upstream the address was already resolved under the product's
// trusted-proxy policy — the same address AccessLog records. The fallback is
// bare ClientIP(r) (no trusted proxies → RemoteAddr); on a proxy-fronted
// deployment without ClientMetadata that yields the proxy's own address,
// which only coarsens Cloudflare's abuse telemetry (remoteip is advisory on
// their side and never changes a verdict) — acceptable for a seam the
// product is expected to wire properly.
func turnstileRemoteIP(r *http.Request) string {
	if ip := ClientIPFrom(r.Context()); ip != "" {
		return ip
	}
	return ClientIP(r)
}
