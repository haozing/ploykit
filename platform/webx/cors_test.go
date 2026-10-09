package webx

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

func doCORS(mw func(http.Handler) http.Handler, method, origin string, extra ...[2]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/x", nil)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	for _, kv := range extra {
		r.Header.Set(kv[0], kv[1])
	}
	w := httptest.NewRecorder()
	mw(okHandler).ServeHTTP(w, r)
	return w
}

func TestCORS_AllowlistHit(t *testing.T) {
	mw := CORS([]string{"https://app.example.com", "https://dev.example.com:5173"}, false)
	w := doCORS(mw, http.MethodGet, "https://app.example.com")
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "https://app.example.com", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, w.Header().Values("Vary"), "Origin")
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Credentials"), "unopened credentials not echoed")
}

func TestCORS_AllowlistMiss(t *testing.T) {
	mw := CORS([]string{"https://app.example.com"}, false)

	w := doCORS(mw, http.MethodGet, "https://evil.example.com")
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))

	w = doCORS(mw, http.MethodGet, "https://xapp.example.com")
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"), "suffix spoofing must not hit")

	w = doCORS(mw, http.MethodGet, "")
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORS_UnconfiguredNoHeaders(t *testing.T) {
	mw := CORS(nil, false)
	w := doCORS(mw, http.MethodGet, "https://app.example.com")
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"), "unconfigured = no CORS headers")
	mw2 := CORS([]string{}, true)
	w = doCORS(mw2, http.MethodOptions, "https://app.example.com",
		[2]string{"Access-Control-Request-Method", "POST"})
	assert.Equal(t, http.StatusOK, w.Code, "empty allowlist = pass-through, downstream answers")
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
}

func TestCORS_Preflight(t *testing.T) {
	mw := CORS([]string{"https://app.example.com"}, false)
	w := doCORS(mw, http.MethodOptions, "https://app.example.com",
		[2]string{"Access-Control-Request-Method", "PATCH"},
		[2]string{"Access-Control-Request-Headers", "Content-Type, X-Workspace-Id"})
	assert.Equal(t, http.StatusNoContent, w.Code, "preflight final answer 204")
	assert.Equal(t, "https://app.example.com", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "PATCH", w.Header().Get("Access-Control-Allow-Methods"), "echoes the request method")
	assert.Equal(t, "Content-Type, X-Workspace-Id", w.Header().Get("Access-Control-Allow-Headers"))
	assert.NotEmpty(t, w.Header().Get("Access-Control-Max-Age"))

	w = doCORS(mw, http.MethodOptions, "https://evil.example.com",
		[2]string{"Access-Control-Request-Method", "POST"})
	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))

	w = doCORS(mw, http.MethodOptions, "https://app.example.com")
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCORS_WildcardAndCredentials(t *testing.T) {

	mw := CORS([]string{"*"}, false)
	w := doCORS(mw, http.MethodGet, "https://any.example.com")
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))

	mwc := CORS([]string{"*"}, true)
	w = doCORS(mwc, http.MethodGet, "https://any.example.com")
	assert.Equal(t, "https://any.example.com", w.Header().Get("Access-Control-Allow-Origin"),
		"credential mode must not echo * (Fetch spec forbids the combination)")
	assert.Equal(t, "true", w.Header().Get("Access-Control-Allow-Credentials"))

	mwl := CORS([]string{"https://app.example.com"}, true)
	w = doCORS(mwl, http.MethodGet, "https://app.example.com")
	assert.Equal(t, "https://app.example.com", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "true", w.Header().Get("Access-Control-Allow-Credentials"))
}

func TestParseOrigins(t *testing.T) {
	assert.Nil(t, ParseOrigins(""))
	assert.Nil(t, ParseOrigins(" , "))
	assert.Equal(t, []string{"https://a.com", "https://b.com:8443"},
		ParseOrigins(" https://a.com , https://b.com:8443 ,,"))
}

func TestCORS_VaryOnMissAndExposeRequestID_W8(t *testing.T) {
	t.Run("非白名单简单请求放行路径也带 Vary: Origin", func(t *testing.T) {
		mw := CORS([]string{"https://app.example.com"}, false)
		w := doCORS(mw, http.MethodGet, "https://evil.example.com")
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"), "非白名单不带放行头")
		assert.Contains(t, w.Header().Values("Vary"), "Origin", "放行路径必须声明 Vary: Origin")
	})

	t.Run("白名单命中暴露 X-Request-Id", func(t *testing.T) {
		mw := CORS([]string{"https://app.example.com"}, false)
		w := doCORS(mw, http.MethodGet, "https://app.example.com")
		assert.Equal(t, "X-Request-Id", w.Header().Get("Access-Control-Expose-Headers"))
	})
}
