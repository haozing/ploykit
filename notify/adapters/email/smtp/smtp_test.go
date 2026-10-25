package smtp

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gomail "github.com/wneessen/go-mail"

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

func TestBuildMessage(t *testing.T) {
	t.Run("合法地址组装 From/To/Subject/Body", func(t *testing.T) {
		msg, err := buildMessage("noreply@example.com", "user@example.com", "Login code", "Your code: 123456")
		require.NoError(t, err)

		assert.Equal(t, []string{"<noreply@example.com>"}, msg.GetFromString())
		assert.Equal(t, []string{"<user@example.com>"}, msg.GetToString())
		assert.Equal(t, []string{"Login code"}, msg.GetGenHeader(gomail.HeaderSubject))

		var buf bytes.Buffer
		_, err = msg.WriteTo(&buf)
		require.NoError(t, err)
		assert.Contains(t, buf.String(), "Your code: 123456")
	})

	t.Run("非法收件人返回错误", func(t *testing.T) {
		_, err := buildMessage("noreply@example.com", "not-an-email", "s", "b")
		assert.Error(t, err)
	})

	t.Run("非法发件人返回错误", func(t *testing.T) {
		_, err := buildMessage("bad@@example", "user@example.com", "s", "b")
		assert.Error(t, err)
	})

	t.Run("中文主题与正文可组装", func(t *testing.T) {
		msg, err := buildMessage("noreply@example.com", "user@example.com", "登录验证码", "你的验证码是 123456")
		require.NoError(t, err)
		var buf bytes.Buffer
		_, err = msg.WriteTo(&buf)
		require.NoError(t, err)

		assert.Contains(t, buf.String(), "123456")
	})
}

// silentSMTPServer accepts TCP connections but never sends the SMTP greeting,
// so a dialing client blocks on the greeting read until the connection closes
// or its context deadline hits. It stands in for a slow/stuck relay.
func silentSMTPServer(t *testing.T) (host string, port int, conns chan net.Conn) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = l.Close() })
	conns = make(chan net.Conn, 4)
	go func() {
		for {
			c, aerr := l.Accept()
			if aerr != nil {
				return
			}
			conns <- c
		}
	}()
	h, p, err := net.SplitHostPort(l.Addr().String())
	require.NoError(t, err)
	pn, err := strconv.Atoi(p)
	require.NoError(t, err)
	return h, pn, conns
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// The send must NOT die with the caller's context: cancel the request-scoped
// parent mid-send and the send keeps waiting on the relay. It only ends (with
// a relay error, not context.Canceled) once the connection actually breaks —
// recorded by closed, which stays false until AFTER the cancel.
func TestSendDetachedFromCallerContext(t *testing.T) {
	host, port, conns := silentSMTPServer(t)
	s := New(Config{Host: host, Port: port, From: "noreply@example.com"}, discardLogger())

	ctx, cancel := context.WithCancel(context.Background())
	type result struct {
		err    error
		closed bool
	}
	res := make(chan result, 1)
	go func() {
		err := s.SendLoginCode(ctx, "user@example.com", "123456")
		res <- result{err: err, closed: true}
	}()

	conn := <-conns // the send dialed in and is now waiting for the greeting
	time.Sleep(100 * time.Millisecond)
	cancel() // the HTTP request times out mid-send
	select {
	case r := <-res:
		t.Fatalf("send returned before the connection broke (err=%v) — it inherited the caller's cancellation", r.err)
	case <-time.After(150 * time.Millisecond):
	}
	_ = conn.Close() // relay finally drops the connection
	r := <-res
	assert.Error(t, r.err)
	assert.NotErrorIs(t, r.err, context.Canceled, "send must not fail with the caller's cancellation")
}

// A hanging relay cannot pin the goroutine forever: the sender's own timeout
// (Config.SendTimeout here, DefaultSendTimeout otherwise) ends the send even
// though the caller's context has no deadline at all.
func TestSendOwnTimeoutCapsHangingRelay(t *testing.T) {
	host, port, conns := silentSMTPServer(t)
	s := New(Config{Host: host, Port: port, From: "noreply@example.com", SendTimeout: 250 * time.Millisecond}, discardLogger())

	start := time.Now()
	err := s.Send(context.Background(), "user@example.com", "s", "b")
	elapsed := time.Since(start)

	assert.Error(t, err)
	assert.NotErrorIs(t, err, context.Canceled)
	assert.GreaterOrEqual(t, elapsed, 200*time.Millisecond, "returned before its own timeout kicked in")
	assert.Less(t, elapsed, 5*time.Second, "own timeout did not cap the send")
	for c := range conns { // keep the connection reference alive until cleanup drains it
		_ = c.Close()
		break
	}
}
