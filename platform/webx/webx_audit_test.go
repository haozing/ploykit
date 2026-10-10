package webx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTimeout_DeadlineRaceNoMisfire(t *testing.T) {
	d := 40 * time.Millisecond
	h := Timeout(d)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(d)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("done"))
	}))

	for i := 0; i < 20; i++ {
		func() {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
			assert.Contains(t, []int{http.StatusOK, http.StatusGatewayTimeout}, rec.Code,
				"两种结局均合法，但必须是其中之一（第 %d 轮）", i)
			if rec.Code == http.StatusOK {
				assert.Equal(t, "done", rec.Body.String())
			} else {
				var body ErrorBody
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
				assert.Equal(t, "E_TIMEOUT", body.Code)
			}
		}()
	}
}

func TestTimeout_PanicRethrown(t *testing.T) {
	h := Timeout(2 * time.Second)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom-in-timeout")
	}))
	require.PanicsWithValue(t, "boom-in-timeout", func() {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	})

	var logged bool
	rh := Recover(captureLogger(&logged))(h)
	rec := httptest.NewRecorder()
	require.NotPanics(t, func() { rh.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil)) })
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.True(t, logged)
}

func TestTimeoutWriter_UnwrapEnablesFlush(t *testing.T) {
	h := Timeout(2 * time.Second)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		rc := http.NewResponseController(w)
		if err := rc.Flush(); err != nil {
			t.Errorf("ResponseController.Flush through timeoutWriter: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestRecover_PartialWriteThenPanicNoDoubleWrite(t *testing.T) {
	var logged bool
	h := Recover(captureLogger(&logged))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial"))
		panic("late-boom")
	}))
	rec := httptest.NewRecorder()
	require.NotPanics(t, func() { h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil)) })
	assert.True(t, logged, "panic 必须记日志")
	assert.Equal(t, http.StatusOK, rec.Code, "保持已开写的状态，不改写")
	assert.Equal(t, "partial", rec.Body.String(), "不得补写 500 包体")
}

func TestRecover_Timeout504ThenLatePanicNo500(t *testing.T) {
	var logged bool
	h := Recover(captureLogger(&logged))(Timeout(50 * time.Millisecond)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		time.Sleep(300 * time.Millisecond)
		panic("after-timeout-boom")
	})))
	rec := httptest.NewRecorder()
	require.NotPanics(t, func() { h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil)) })
	assert.Equal(t, http.StatusGatewayTimeout, rec.Code, "恰一个 504")
	assert.Contains(t, rec.Body.String(), "E_TIMEOUT")
	assert.NotContains(t, rec.Body.String(), "E_INTERNAL", "不得在 504 之后再补 500（双写）")
}

func TestSetSessionCookie_AttributesLocked(t *testing.T) {
	cfg := DefaultAuthConfig()
	cfg.CookieDomain = "app.example.com"
	cfg.IPHashSecret = "unit-test-salt"
	cfg.Secure = true // 生产姿态显式打开（缺省 false，见 DefaultAuthConfig 注释）
	rec := httptest.NewRecorder()
	exp := time.Now().Add(24 * time.Hour).UTC()
	cfg.SetSessionCookie(rec, "tok-1", exp)

	cookies := rec.Result().Cookies()
	require.Len(t, cookies, 1)
	ck := cookies[0]
	assert.Equal(t, "tk_auth", ck.Name)
	assert.Equal(t, "tok-1", ck.Value)
	assert.Equal(t, "/", ck.Path)
	assert.Equal(t, "app.example.com", ck.Domain)
	assert.True(t, ck.HttpOnly, "会话 cookie 必须 HttpOnly")
	assert.True(t, ck.Secure, "显式 Secure=true 应落 cookie")
	assert.Equal(t, http.SameSiteLaxMode, ck.SameSite)
	assert.WithinDuration(t, exp, ck.Expires, time.Second)
}

func TestClearSessionCookie_AttributesLocked(t *testing.T) {
	cfg := DefaultAuthConfig()
	cfg.Secure = true
	rec := httptest.NewRecorder()
	cfg.ClearSessionCookie(rec)

	cookies := rec.Result().Cookies()
	require.Len(t, cookies, 1)
	ck := cookies[0]
	assert.Equal(t, "tk_auth", ck.Name)
	assert.Empty(t, ck.Value)
	assert.Equal(t, "/", ck.Path)
	assert.Equal(t, -1, ck.MaxAge, "MaxAge=-1 立即过期")
	assert.True(t, ck.HttpOnly)
	assert.True(t, ck.Secure)
	assert.Equal(t, http.SameSiteLaxMode, ck.SameSite)
}

func TestDefaultAuthConfig_SecureDefaultsFalse(t *testing.T) {
	// 本地 HTTP / 内网部署的默认可用性：Secure 缺省 false（aiblog/risk-engine
	// 实录——true 默认使登录在纯 HTTP 下以 CSRF 报错失败，根因隔两层）。
	// 生产必须在配置处显式 cfg.Secure = true。
	assert.False(t, DefaultAuthConfig().Secure)
}

func TestSecurityHeaders_HeadersLocked(t *testing.T) {
	h := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "DENY", rec.Header().Get("X-Frame-Options"))
	assert.Equal(t, "same-origin", rec.Header().Get("Referrer-Policy"))
	assert.Equal(t, "default-src 'none'; frame-ancestors 'none'", rec.Header().Get("Content-Security-Policy"))
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestFailOpenLimiter(t *testing.T) {
	var l Limiter = FailOpenLimiter{}
	for range 100 {
		ok, retry := l.Allow(nil, "any-key", 0)
		assert.True(t, ok)
		assert.Zero(t, retry)
	}
}

type errCaptureHandler struct{ hit *bool }

func (h *errCaptureHandler) Enabled(_ context.Context, l slog.Level) bool {
	return l >= slog.LevelError
}
func (h *errCaptureHandler) Handle(_ context.Context, _ slog.Record) error {
	*h.hit = true
	return nil
}
func (h *errCaptureHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *errCaptureHandler) WithGroup(string) slog.Handler      { return h }

func captureLogger(hit *bool) *slog.Logger { return slog.New(&errCaptureHandler{hit}) }
