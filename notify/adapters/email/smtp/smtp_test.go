package smtp

import (
	"bytes"
	"context"
	"testing"

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
