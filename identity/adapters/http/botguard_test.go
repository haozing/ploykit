package http_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	httplib "github.com/haozing/ploykit/identity/adapters/http"
	"github.com/haozing/ploykit/platform/webx"
)

// The BotGuard seam (Deps.BotGuard): a marking guard proves the four
// bot-facing routes run through it, the session-class auth routes do not,
// and nil changes nothing. The guard blocks (never calls next) so the
// handlers behind it never touch the nil services of these minimal Deps.

var botGuardRoutes = []string{
	"/auth/register",
	"/auth/send-code",
	"/auth/forgot-password",
	"/auth/send-verification",
}

func markAndBlockGuard(seen map[string]int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seen[r.URL.Path]++
			w.Header().Set("X-Bot-Guard", r.URL.Path)
			webx.ErrForbidden(w, "human verification required")
		})
	}
}

func botGuardPost(mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	// Invalid JSON on purpose: routes that DO reach their handler fail in
	// DecodeJSON (400) before any nil service is dereferenced.
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{"))
	r.RemoteAddr = "203.0.113.9:5555"
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestMount_BotGuardWrapsBotFacingRoutes(t *testing.T) {
	seen := map[string]int{}
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{AuthCfg: webx.DefaultAuthConfig(), BotGuard: markAndBlockGuard(seen)})

	for _, path := range botGuardRoutes {
		w := botGuardPost(mux, path)
		assert.Equal(t, http.StatusForbidden, w.Code, path)
		assert.Equal(t, path, w.Header().Get("X-Bot-Guard"), path)
		assert.Equal(t, 1, seen[path], "request must have passed the guard: %s", path)
	}
	assert.Len(t, seen, len(botGuardRoutes))
}

// send-verification's guard sits OUTSIDE RequireHuman: an anonymous bot is
// judged (403 from the guard), never answered by the session verdict (401).
func TestMount_BotGuardOutsideRequireHuman(t *testing.T) {
	seen := map[string]int{}
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{AuthCfg: webx.DefaultAuthConfig(), BotGuard: markAndBlockGuard(seen)})

	w := botGuardPost(mux, "/auth/send-verification")
	require.Equal(t, http.StatusForbidden, w.Code,
		"401 would mean RequireHuman answered first — BotGuard must be outermost")
	code, _ := errEnvelope(t, w)
	assert.Equal(t, "E_FORBIDDEN", code)
}

// login / verify-code / reset-password are deliberately NOT guarded (their
// defense is per-IP rate limiting; see Deps.BotGuard's doc comment). What
// matters here is only that the guard is bypassed: each request is answered
// by its handler, never by the 403/marker.
func TestMount_BotGuardSkipsSessionClassRoutes(t *testing.T) {
	seen := map[string]int{}
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{AuthCfg: webx.DefaultAuthConfig(), BotGuard: markAndBlockGuard(seen)})

	// login / verify-code parse the body first → bad JSON is 400;
	// reset-password nil-checks its service first → 500. Either way the
	// handler — not the guard — produced the response.
	for path, want := range map[string]int{
		"/auth/login":          http.StatusBadRequest,
		"/auth/verify-code":    http.StatusBadRequest,
		"/auth/reset-password": http.StatusInternalServerError,
	} {
		w := botGuardPost(mux, path)
		assert.Equal(t, want, w.Code, "unguarded route must be answered by its handler: %s", path)
		assert.Empty(t, w.Header().Get("X-Bot-Guard"), path)
		assert.NotEqual(t, "E_FORBIDDEN", func() string { c, _ := errEnvelope(t, w); return c }(), path)
	}
	assert.Empty(t, seen)
}

// The compatibility floor: nil BotGuard = byte-for-byte today's behavior —
// requests reach the handlers (register/send-code parse the body → bad JSON
// 400; forgot-password nil-checks its service → 500; anonymous
// send-verification answered by RequireHuman's 401).
func TestMount_NilBotGuardUnchanged(t *testing.T) {
	mux := http.NewServeMux()
	httplib.Mount(mux, httplib.Deps{AuthCfg: webx.DefaultAuthConfig()})

	for path, want := range map[string]int{
		"/auth/register":        http.StatusBadRequest,
		"/auth/send-code":       http.StatusBadRequest,
		"/auth/forgot-password": http.StatusInternalServerError,
	} {
		w := botGuardPost(mux, path)
		require.Equal(t, want, w.Code, path)
	}
	w := botGuardPost(mux, "/auth/send-verification")
	assert.Equal(t, http.StatusUnauthorized, w.Code, "anonymous send-verification stays 401")
	code, _ := errEnvelope(t, w)
	assert.Equal(t, "E_UNAUTHENTICATED", code)
}
