package smtp

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewWithTemplates_ZeroValueMatchesLegacyCopy(t *testing.T) {
	s, err := NewWithTemplates(Config{}, Templates{}, nil)
	require.NoError(t, err)
	require.NotNil(t, s)

	t.Run("登录验证码", func(t *testing.T) {
		data := LoginCodeData{Code: "123456"}
		subject, err := render(s.tpl.LoginCodeSubject, data)
		require.NoError(t, err)
		body, err := render(s.tpl.LoginCodeBody, data)
		require.NoError(t, err)
		assert.Equal(t, "你的登录验证码", subject)
		assert.Equal(t, "验证码：123456\n\n若非本人操作，请忽略本邮件。", body)
	})

	t.Run("工作区邀请", func(t *testing.T) {
		data := InviteData{Workspace: "水镜", InvitationID: "inv-1"}
		subject, err := render(s.tpl.InviteSubject, data)
		require.NoError(t, err)
		body, err := render(s.tpl.InviteBody, data)
		require.NoError(t, err)
		assert.Equal(t, "工作区邀请", subject)
		assert.Equal(t, "你被邀请加入工作区「水镜」。\n\n邀请标识：inv-1", body)
	})

	t.Run("重置密码", func(t *testing.T) {
		data := LinkData{Link: "https://e.example/reset?t=1"}
		subject, err := render(s.tpl.PasswordResetSubject, data)
		require.NoError(t, err)
		body, err := render(s.tpl.PasswordResetBody, data)
		require.NoError(t, err)
		assert.Equal(t, "重置你的密码", subject)
		assert.Equal(t, "点击以下链接重置密码（有效期有限；若非本人操作，请忽略本邮件）：\nhttps://e.example/reset?t=1", body)
	})

	t.Run("邮箱验证", func(t *testing.T) {
		data := LinkData{Link: "https://e.example/verify?t=2"}
		subject, err := render(s.tpl.EmailVerificationSubject, data)
		require.NoError(t, err)
		body, err := render(s.tpl.EmailVerificationBody, data)
		require.NoError(t, err)
		assert.Equal(t, "验证你的邮箱", subject)
		assert.Equal(t, "点击以下链接完成邮箱验证：\nhttps://e.example/verify?t=2", body)
	})
}

func TestNewWithTemplates_CustomTemplatesOverride(t *testing.T) {
	tpl := Templates{
		LoginCode: Template{
			Subject: "Your login code",
			Body:    "Hi,\n\nYour verification code is {{.Code}}. It expires soon.\n\n— The Team",
		},
		Invite: Template{
			Subject: "You're invited to {{.Workspace}}",
			Body:    "Click to join {{.Workspace}} (invitation {{.InvitationID}}).",
		},
		PasswordReset: Template{
			Subject: "Reset your password",
			Body:    "Reset link (expires soon): {{.Link}}\nIf you didn't request this, ignore this email.",
		},
		EmailVerification: Template{
			Subject: "Verify your email",
			Body:    "Verify here: {{.Link}}",
		},
	}
	s, err := NewWithTemplates(Config{}, tpl, nil)
	require.NoError(t, err)
	require.NotNil(t, s)

	t.Run("登录验证码占位符替换", func(t *testing.T) {
		data := LoginCodeData{Code: "654321"}
		subject, err := render(s.tpl.LoginCodeSubject, data)
		require.NoError(t, err)
		body, err := render(s.tpl.LoginCodeBody, data)
		require.NoError(t, err)
		assert.Equal(t, "Your login code", subject)
		assert.Equal(t, "Hi,\n\nYour verification code is 654321. It expires soon.\n\n— The Team", body)
	})

	t.Run("邀请主题与正文占位符替换", func(t *testing.T) {
		data := InviteData{Workspace: "Acme", InvitationID: "inv-9"}
		subject, err := render(s.tpl.InviteSubject, data)
		require.NoError(t, err)
		body, err := render(s.tpl.InviteBody, data)
		require.NoError(t, err)
		assert.Equal(t, "You're invited to Acme", subject)
		assert.Equal(t, "Click to join Acme (invitation inv-9).", body)
	})

	t.Run("重置密码与邮箱验证链接替换", func(t *testing.T) {
		resetData := LinkData{Link: "https://e.example/reset?token=abc"}
		subject, err := render(s.tpl.PasswordResetSubject, resetData)
		require.NoError(t, err)
		body, err := render(s.tpl.PasswordResetBody, resetData)
		require.NoError(t, err)
		assert.Equal(t, "Reset your password", subject)
		assert.Equal(t, "Reset link (expires soon): https://e.example/reset?token=abc\nIf you didn't request this, ignore this email.", body)

		verifyData := LinkData{Link: "https://e.example/verify?token=xyz"}
		subject, err = render(s.tpl.EmailVerificationSubject, verifyData)
		require.NoError(t, err)
		body, err = render(s.tpl.EmailVerificationBody, verifyData)
		require.NoError(t, err)
		assert.Equal(t, "Verify your email", subject)
		assert.Equal(t, "Verify here: https://e.example/verify?token=xyz", body)
	})
}

func TestNewWithTemplates_PartialOverrideFallsBackToDefault(t *testing.T) {
	tpl := Templates{
		LoginCode: Template{Subject: "Login code ({{.Code}})"},
		// Body empty → default body; all other groups empty → all defaults.
	}
	s, err := NewWithTemplates(Config{}, tpl, nil)
	require.NoError(t, err)

	data := LoginCodeData{Code: "000111"}
	subject, err := render(s.tpl.LoginCodeSubject, data)
	require.NoError(t, err)
	assert.Equal(t, "Login code (000111)", subject)

	body, err := render(s.tpl.LoginCodeBody, data)
	require.NoError(t, err)
	assert.Equal(t, "验证码：000111\n\n若非本人操作，请忽略本邮件。", body)

	inviteSubject, err := render(s.tpl.InviteSubject, InviteData{Workspace: "水镜"})
	require.NoError(t, err)
	assert.Equal(t, "工作区邀请", inviteSubject)
}

func TestNewWithTemplates_BadTemplateFailsConstruction(t *testing.T) {
	t.Run("主题语法错误", func(t *testing.T) {
		_, err := NewWithTemplates(Config{}, Templates{
			LoginCode: Template{Subject: "Your code: {{.Code"},
		}, nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "login_code.subject")
	})

	t.Run("正文语法错误", func(t *testing.T) {
		_, err := NewWithTemplates(Config{}, Templates{
			PasswordReset: Template{Body: "Reset: {{.Link}} {{end}}"},
		}, nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "password_reset.body")
	})
}

func TestSender_RenderMismatchFailsSendWithoutNetwork(t *testing.T) {
	// LoginCode templates receive LoginCodeData; referencing {{.Link}} is a
	// field miss and must fail the send at render time, before any dial.
	s, err := NewWithTemplates(Config{}, Templates{
		LoginCode: Template{Body: "reset instead: {{.Link}}"},
	}, nil)
	require.NoError(t, err)

	err = s.SendLoginCode(context.Background(), "user@example.com", "123456")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "login_code.body")
}
