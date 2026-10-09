package webx

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func holderChain(t *testing.T, sessions SessionStore) (*bytes.Buffer, http.Handler) {
	t.Helper()
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	cfg := &AuthConfig{CookieName: "tk_auth", SessionTTL: time.Hour, Secure: false}
	h := PrincipalHolder()(
		AccessLog(log)(
			Authenticate(cfg, sessions, &fakePATs{})(
				http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.WriteHeader(http.StatusOK)
				}))))
	return &buf, h
}

func TestPrincipalHolder_AuthenticatedRequestLogsUserID_W11(t *testing.T) {
	buf, h := holderChain(t, &fakeSessions{p: &Principal{UserID: "u-w11"}})
	h.ServeHTTP(httptest.NewRecorder(), reqWithCookie("tk_auth", "tok"))
	assert.Contains(t, buf.String(), "user_id=u-w11", "AccessLog 在 Authenticate 外层也应记到 user_id（经 holder cell）")
	assert.Contains(t, buf.String(), "status=200")
}

func TestPrincipalHolder_AnonymousRequestLogsEmptyUserID_W11(t *testing.T) {
	buf, h := holderChain(t, &fakeSessions{})
	h.ServeHTTP(httptest.NewRecorder(), reqWithCookie("tk_auth", "tok"))
	assert.Contains(t, buf.String(), `user_id=""`, "匿名请求 user_id 应为空")
}

func TestPrincipalHolder_CellIsPerRequest_W11(t *testing.T) {
	sessions := &fakeSessions{p: &Principal{UserID: "u-first"}}
	buf, h := holderChain(t, sessions)
	h.ServeHTTP(httptest.NewRecorder(), reqWithCookie("tk_auth", "tok"))
	assert.Contains(t, buf.String(), "user_id=u-first")

	sessions.p = nil
	h.ServeHTTP(httptest.NewRecorder(), reqWithCookie("tk_auth", "tok"))
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	require.Len(t, lines, 2, "两次请求两行日志")
	assert.Contains(t, lines[1], `user_id=""`, "第二个（匿名）请求 user_id 必须为空，不得串号")
}

func TestAccessLog_NoHolderFallsBackToCtx_W11(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	outer := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), &Principal{UserID: "u-ctx"})))
		})
	}
	h := outer(AccessLog(log)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Contains(t, buf.String(), "user_id=u-ctx", "无 holder 时回落 ctx 读取必须保持")
}

func TestPrincipalHolder_PATChannelFillsCell_W11(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	cfg := &AuthConfig{CookieName: "tk_auth", SessionTTL: time.Hour, Secure: false}
	h := PrincipalHolder()(
		AccessLog(log)(
			Authenticate(cfg, &fakeSessions{}, &fakePATs{p: &Principal{UserID: "u-pat"}})(
				http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer tk_pat")
	h.ServeHTTP(httptest.NewRecorder(), req)
	assert.Contains(t, buf.String(), "user_id=u-pat", "PAT 认证成功同样填充 cell")
}

func TestPrincipalCell_ConcurrentSafe(t *testing.T) {
	cell := &PrincipalCell{}
	done := make(chan struct{})
	go func() {
		for i := 0; i < 100; i++ {
			cell.Set(&Principal{UserID: "u"})
		}
		close(done)
	}()
	for i := 0; i < 100; i++ {
		_ = cell.Get()
	}
	<-done
	require.NotNil(t, cell.Get())
	cell.Set(nil)
	assert.Nil(t, cell.Get(), "Set(nil) 清空（匿名语义）")
}
