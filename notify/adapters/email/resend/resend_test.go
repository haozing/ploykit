package resend

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/notify/adapters/email/mailtpl"
	"github.com/haozing/ploykit/notify/app"
)

var _ app.EmailSender = (*Sender)(nil)

type identityEmailSenderShape interface {
	SendLoginCode(ctx context.Context, to, code string) error
	SendInvite(ctx context.Context, to, workspaceName, invitationID string) error
	SendPasswordReset(ctx context.Context, to, link string) error
	SendEmailVerification(ctx context.Context, to, link string) error
}

var _ identityEmailSenderShape = (*Sender)(nil)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type capturedRequest struct {
	Method string
	Path   string
	Auth   string
	CT     string
	Body   sendRequest
}

// fakeResend records the last request and answers with the given status and
// body. Slow mode delays the response to exercise timeouts.
func fakeResend(t *testing.T, status int, respBody string) (*httptest.Server, *captured) {
	t.Helper()
	c := &captured{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &c.req.Body)
		c.req.Method, c.req.Path, c.req.Auth, c.req.CT = r.Method, r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Content-Type")
		c.mu.Lock()
		c.count++
		c.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respBody))
	}))
	t.Cleanup(srv.Close)
	return srv, c
}

type captured struct {
	req   capturedRequest
	mu    sync.Mutex
	count int
}

func newSender(t *testing.T, endpoint string, tpl mailtpl.Templates) *Sender {
	t.Helper()
	s, err := NewWithTemplates(Config{
		APIKey:   "re_test_key",
		From:     "noreply@example.com",
		Endpoint: endpoint,
	}, tpl, discardLogger())
	require.NoError(t, err)
	return s
}

func TestSendRequestShape(t *testing.T) {
	srv, c := fakeResend(t, http.StatusOK, `{"id":"email-1"}`)
	s := newSender(t, srv.URL, mailtpl.Templates{})

	require.NoError(t, s.SendLoginCode(context.Background(), "user@example.com", "123456"))

	assert.Equal(t, http.MethodPost, c.req.Method)
	assert.Equal(t, "/emails", c.req.Path)
	assert.Equal(t, "Bearer re_test_key", c.req.Auth)
	assert.Equal(t, "application/json", c.req.CT)
	assert.Equal(t, "noreply@example.com", c.req.Body.From)
	assert.Equal(t, []string{"user@example.com"}, c.req.Body.To)
	assert.Equal(t, "你的登录验证码", c.req.Body.Subject, "零值模板回退内置中文文案（与 smtp 同源）")
	assert.Contains(t, c.req.Body.Text, "123456")
}

func TestCustomTemplatesRender(t *testing.T) {
	srv, c := fakeResend(t, http.StatusOK, `{}`)
	s := newSender(t, srv.URL, mailtpl.Templates{
		LoginCode: mailtpl.Template{Subject: "Code {{.Code}}", Body: "Your code: {{.Code}}"},
	})

	require.NoError(t, s.SendLoginCode(context.Background(), "u@e.com", "777"))
	assert.Equal(t, "Code 777", c.req.Body.Subject)
	assert.Equal(t, "Your code: 777", c.req.Body.Text)
}

func TestAPIMethodMatrix(t *testing.T) {
	t.Run("四模板方法各自渲染数据", func(t *testing.T) {
		srv, c := fakeResend(t, http.StatusOK, `{}`)
		s := newSender(t, srv.URL, mailtpl.Templates{})
		require.NoError(t, s.SendInvite(context.Background(), "u@e.com", "水镜", "inv-1"))
		assert.Contains(t, c.req.Body.Text, "水镜")
		assert.Contains(t, c.req.Body.Text, "inv-1")
		require.NoError(t, s.SendPasswordReset(context.Background(), "u@e.com", "https://x/reset"))
		assert.Contains(t, c.req.Body.Text, "https://x/reset")
		require.NoError(t, s.SendEmailVerification(context.Background(), "u@e.com", "https://x/verify"))
		assert.Contains(t, c.req.Body.Text, "https://x/verify")
	})

	t.Run("裸 Send 直通车", func(t *testing.T) {
		srv, c := fakeResend(t, http.StatusOK, `{}`)
		s := newSender(t, srv.URL, mailtpl.Templates{})
		require.NoError(t, s.Send(context.Background(), "u@e.com", " subj ", " body "))
		assert.Equal(t, " subj ", c.req.Body.Subject)
	})
}

func TestAPIErrorMapping(t *testing.T) {
	t.Run("4xx 错误信封映射为 APIError", func(t *testing.T) {
		srv, _ := fakeResend(t, http.StatusUnauthorized, `{"name":"missing_api_key","message":"Missing API key"}`)
		s := newSender(t, srv.URL, mailtpl.Templates{})

		err := s.Send(context.Background(), "u@e.com", "s", "b")
		require.Error(t, err)
		var apiErr *APIError
		require.ErrorAs(t, err, &apiErr)
		assert.Equal(t, http.StatusUnauthorized, apiErr.Status)
		assert.Equal(t, "missing_api_key", apiErr.Name, "name 是区分『key 无效』与『收件人被拒』的机器可读标识")
		assert.Equal(t, "Missing API key", apiErr.Message)
	})

	t.Run("非 JSON 响应降级为 http_error", func(t *testing.T) {
		srv, _ := fakeResend(t, http.StatusBadGateway, `<html>bad gateway</html>`)
		s := newSender(t, srv.URL, mailtpl.Templates{})

		err := s.Send(context.Background(), "u@e.com", "s", "b")
		var apiErr *APIError
		require.ErrorAs(t, err, &apiErr)
		assert.Equal(t, "http_error", apiErr.Name)
		assert.Contains(t, apiErr.Message, "bad gateway")
	})
}

func TestConfigGuards(t *testing.T) {
	srv, _ := fakeResend(t, http.StatusOK, `{}`)

	t.Run("缺 API key 明确报错", func(t *testing.T) {
		s, err := NewWithTemplates(Config{From: "a@b.c", Endpoint: srv.URL}, mailtpl.Templates{}, discardLogger())
		require.NoError(t, err)
		assert.ErrorIs(t, s.Send(context.Background(), "u@e.com", "s", "b"), errNoAPIKey)
	})

	t.Run("缺 From 明确报错", func(t *testing.T) {
		s, err := NewWithTemplates(Config{APIKey: "re_x", Endpoint: srv.URL}, mailtpl.Templates{}, discardLogger())
		require.NoError(t, err)
		assert.ErrorIs(t, s.Send(context.Background(), "u@e.com", "s", "b"), errNoFrom)
	})

	t.Run("模板解析失败拒绝构造", func(t *testing.T) {
		_, err := NewWithTemplates(Config{APIKey: "re_x", Endpoint: srv.URL},
			mailtpl.Templates{LoginCode: mailtpl.Template{Subject: "{{.Code"}}, discardLogger())
		require.Error(t, err)
	})
}

// The send must not inherit the caller's cancellation: a request-scoped ctx
// that is already canceled when Send is called still delivers the mail.
func TestSendDetachedFromCallerContext(t *testing.T) {
	srv, c := fakeResend(t, http.StatusOK, `{}`)
	s := newSender(t, srv.URL, mailtpl.Templates{})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.NoError(t, s.Send(ctx, "user@example.com", "s", "b"), "已取消的父 ctx 不得杀死发信")
	assert.Equal(t, 1, c.count)
}

// A hanging API cannot pin the goroutine: the sender's own timeout ends the
// send even though the caller's ctx has no deadline.
func TestSendOwnTimeoutCapsHangingAPI(t *testing.T) {
	var hits int
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits++
		mu.Unlock()
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	s, err := NewWithTemplates(Config{
		APIKey: "re_x", From: "a@b.c", Endpoint: srv.URL, SendTimeout: 150 * time.Millisecond,
	}, mailtpl.Templates{}, discardLogger())
	require.NoError(t, err)

	start := time.Now()
	err = s.Send(context.Background(), "u@e.com", "s", "b")
	elapsed := time.Since(start)

	assert.Error(t, err)
	assert.GreaterOrEqual(t, elapsed, 140*time.Millisecond)
	assert.Less(t, elapsed, 5*time.Second, "自有超时未兜住挂起的 API")
	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 1, hits)
}
