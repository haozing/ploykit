package settingshttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/sealx"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/settings"
)

var errBadResendKey = errors.New("resend_api_key 必须以 re_ 开头")

func newTestMux(t *testing.T, store *settings.Store, mailer Mailer, mailMode string, guard func(http.Handler) http.Handler) *http.ServeMux {
	t.Helper()
	if guard == nil {
		guard = func(next http.Handler) http.Handler { return next }
	}
	mux := http.NewServeMux()
	MountAdmin(mux, AdminDeps{
		Store: store, Guard: guard, Mailer: mailer,
		MailModeFn: func() string { return mailMode },
		Log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return mux
}

func mustTestSecrets(t *testing.T, seed byte) *sealx.Secrets {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = seed
	}
	s, err := sealx.NewSecrets(key)
	require.NoError(t, err)
	return s
}

func doJSON(t *testing.T, mux *http.ServeMux, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, path, rd)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	out := map[string]any{}
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &out)
	}
	return w, out
}

func TestPutRejectedBeforeStore(t *testing.T) {

	mux := newTestMux(t, &settings.Store{}, nil, "", nil)

	cases := []struct {
		name    string
		path    string
		body    string
		code    int
		errCode string
	}{
		{"白名单外键 400", "/api/admin/settings/theme_color", `{"value":"#fff"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"banner_kind 非法 400", "/api/admin/settings/banner_kind", `{"value":"danger"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"maintenance_mode 非法 400", "/api/admin/settings/maintenance_mode", `{"value":"yes"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"allow_signup 非法 400", "/api/admin/settings/allow_signup", `{"value":"true"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"allowed_domains 非域名 400", "/api/admin/settings/allowed_domains", `{"value":"随便"}`, http.StatusBadRequest, "E_VALIDATION"},

		{"限流速率键非整数 400", "/api/admin/settings/rate_limit_per_user_per_min", `{"value":"abc"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"限流速率键超上限 400", "/api/admin/settings/rate_limit_per_user_per_min", `{"value":"100001"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"IP 限流键负数 400", "/api/admin/settings/rate_limit_per_ip_per_min", `{"value":"-1"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"IP 限流键小数 400", "/api/admin/settings/rate_limit_per_ip_per_min", `{"value":"1.5"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"豁免名单非 IP/CIDR 400", "/api/admin/settings/rate_limit_allowlist", `{"value":"not-an-ip"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"豁免名单坏 CIDR 掩码 400", "/api/admin/settings/rate_limit_allowlist", `{"value":"10.0.0.0/99"}`, http.StatusBadRequest, "E_VALIDATION"},
		{"坏 JSON 400", "/api/admin/settings/banner_text", "{", http.StatusBadRequest, "E_BAD_JSON"},
		{"未知字段 400（严格解码）", "/api/admin/settings/banner_text", `{"value":"x","extra":1}`, http.StatusBadRequest, "E_BAD_JSON"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w, body := doJSON(t, mux, http.MethodPut, c.path, c.body)
			assert.Equal(t, c.code, w.Code)
			assert.Equal(t, c.errCode, body["error"])
		})
	}
}

func TestMountAdminRequiresGuard(t *testing.T) {
	assert.Panics(t, func() {
		MountAdmin(http.NewServeMux(), AdminDeps{Store: &settings.Store{}})
	}, "Guard 缺失必须在装配期 panic（平台管理员门不可静默失守）")
}

type fakeMailer struct {
	to, subject, body string
	calls             int
	err               error
}

func (f *fakeMailer) Send(_ context.Context, to, subject, body string) error {
	f.calls++
	f.to, f.subject, f.body = to, subject, body
	return f.err
}

func TestTestEmail(t *testing.T) {
	t.Run("to 缺失 400", func(t *testing.T) {
		mux := newTestMux(t, &settings.Store{}, &fakeMailer{}, "", nil)
		w, body := doJSON(t, mux, http.MethodPost, "/api/admin/settings/test-email", `{}`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Equal(t, "E_VALIDATION", body["error"])
	})
	t.Run("to 非邮箱 400", func(t *testing.T) {
		mux := newTestMux(t, &settings.Store{}, &fakeMailer{}, "", nil)
		w, _ := doJSON(t, mux, http.MethodPost, "/api/admin/settings/test-email", `{"to":"not-an-email"}`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("to 含 CR/LF/制表/双@/无点域名 400", func(t *testing.T) {
		mux := newTestMux(t, &settings.Store{}, &fakeMailer{}, "", nil)
		for _, to := range []string{
			`a@b.com` + "\r" + `x`,
			`a@b.com` + "\n" + `x`,
			"a@b.com\tx",
			"a@@b",
			"a@b",
		} {
			w, _ := doJSON(t, mux, http.MethodPost, "/api/admin/settings/test-email",
				`{"to":`+strconv.Quote(to)+`}`)
			assert.Equal(t, http.StatusBadRequest, w.Code, "to=%q 应 400", to)
		}
	})
	t.Run("mailer 未接线 503", func(t *testing.T) {
		mux := newTestMux(t, &settings.Store{}, nil, "", nil)
		w, body := doJSON(t, mux, http.MethodPost, "/api/admin/settings/test-email", `{"to":"a@b.com"}`)
		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
		assert.Equal(t, "E_UNAVAILABLE", body["error"])
	})
	t.Run("MailMode=dev → mode=dev + hint", func(t *testing.T) {
		fm := &fakeMailer{}
		mux := newTestMux(t, &settings.Store{}, fm, MailModeDev, nil)
		w, body := doJSON(t, mux, http.MethodPost, "/api/admin/settings/test-email", `{"to":"a@b.com"}`)
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "dev", body["mode"])
		assert.Contains(t, body["hint"], "日志")
		assert.Equal(t, 1, fm.calls, "dev 通道同样真实调用 Send（内容进日志）")
	})
	t.Run("smtp fake → mode=smtp/sent", func(t *testing.T) {
		fm := &fakeMailer{}
		mux := newTestMux(t, &settings.Store{}, fm, MailModeSMTP, nil)
		w, body := doJSON(t, mux, http.MethodPost, "/api/admin/settings/test-email", `{"to":"a@b.com"}`)
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "smtp", body["mode"])
		assert.Equal(t, "sent", body["status"])
		assert.Equal(t, 1, fm.calls)
		assert.Equal(t, "a@b.com", fm.to)
		assert.NotEmpty(t, fm.subject, "测试邮件应有主题")
	})
	t.Run("smtp 失败 502", func(t *testing.T) {
		fm := &fakeMailer{err: context.DeadlineExceeded}
		mux := newTestMux(t, &settings.Store{}, fm, "", nil)
		w, body := doJSON(t, mux, http.MethodPost, "/api/admin/settings/test-email", `{"to":"a@b.com"}`)
		assert.Equal(t, http.StatusBadGateway, w.Code)
		assert.Equal(t, "E_MAIL_SEND", body["error"])
	})
}

func TestGuardEnforced(t *testing.T) {
	platformAdminGuard := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := webx.PrincipalFromRequest(r)
			if p == nil {
				webx.ErrUnauthenticated(w, "authentication required")
				return
			}
			if !p.IsPlatformAdmin {
				webx.ErrForbidden(w, "platform admin required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
	mux := newTestMux(t, &settings.Store{}, nil, "", platformAdminGuard)
	req := func(principal *webx.Principal) *http.Request {
		r := httptest.NewRequest(http.MethodPut, "/api/admin/settings/banner_text",
			strings.NewReader(`{"value":"x"}`))
		if principal != nil {
			r = r.WithContext(webx.WithPrincipal(r.Context(), principal))
		}
		return r
	}

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req(nil))
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req(&webx.Principal{UserID: "u1", IsPlatformAdmin: false}))
	assert.Equal(t, http.StatusForbidden, w.Code)

	w = httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPut, "/api/admin/settings/banner_kind",
		strings.NewReader(`{"value":"danger"}`))
	r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: "u1", Email: "ops@x.com", IsPlatformAdmin: true}))
	mux.ServeHTTP(w, r)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func newStoreEnvDB(t *testing.T) (*pgxpool.Pool, *settings.Store) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS site_settings (
		  key        text PRIMARY KEY,
		  value      text NOT NULL,
		  updated_at timestamptz NOT NULL DEFAULT now(),
		  updated_by text
		)`)
	require.NoError(t, err)
	_, _ = pool.Exec(ctx, `DELETE FROM site_settings`)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM site_settings`) })
	return pool, settings.NewStore(pool)
}

func TestPutHandlerIntegration(t *testing.T) {
	_, s := newStoreEnvDB(t)
	mux := newTestMux(t, s, nil, "", nil)
	ctx := context.Background()

	w, body := doJSON(t, mux, http.MethodPut, "/api/admin/settings/allowed_domains",
		`{"value":" A.COM , b.org "}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "a.com,b.org", body["value"])
	v, found, err := s.Get(ctx, settings.KeyAllowedDomains)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "a.com,b.org", v)

	w, body = doJSON(t, mux, http.MethodGet, "/api/admin/settings", "")
	require.Equal(t, http.StatusOK, w.Code)
	items, _ := body["items"].(map[string]any)
	assert.Equal(t, "a.com,b.org", items[settings.KeyAllowedDomains])
	eff, _ := body["effective"].(map[string]any)
	assert.Equal(t, "1", eff[settings.KeyAllowSignup], "表缺键走默认（开放注册）")
	desc, _ := body["descriptions"].(map[string]any)
	assert.NotEmpty(t, desc[settings.KeyMaintenanceMode])
}

// passthroughLogMux mounts AdminDeps with a log handler capturing into buf.
func passthroughLogMux(t *testing.T, store *settings.Store, buf *bytes.Buffer) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	MountAdmin(mux, AdminDeps{
		Store:      store,
		Guard:      func(next http.Handler) http.Handler { return next },
		MailModeFn: func() string { return MailModeSMTP },
		Log:        slog.New(slog.NewTextHandler(buf, nil)),
	})
	return mux
}

func TestListMaskingIntegration(t *testing.T) {
	pool, s := newStoreEnvDB(t)
	ctx := context.Background()
	sealed := s.WithSealer(mustTestSecrets(t, 'k'))
	require.NoError(t, sealed.Set(ctx, settings.KeySMTPPass, "super-secret", "ops@x.com"))
	// 直接落一行 sealed 串模拟历史数据（items 表来源）。
	_, err := pool.Exec(ctx, `
		INSERT INTO site_settings (key, value, updated_by) VALUES ($1, $2, 'ops')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
		settings.KeySMTPHost, "smtp.example.com")
	require.NoError(t, err)

	mux := newTestMux(t, sealed, nil, MailModeSMTP, nil)
	w, body := doJSON(t, mux, http.MethodGet, "/api/admin/settings", "")
	require.Equal(t, http.StatusOK, w.Code)

	items, _ := body["items"].(map[string]any)
	assert.Equal(t, settings.MaskedValue, items[settings.KeySMTPPass], "items 表敏感键回掩码")
	assert.Equal(t, "smtp.example.com", items[settings.KeySMTPHost], "非敏感键原样")
	eff, _ := body["effective"].(map[string]any)
	assert.Equal(t, settings.MaskedValue, eff[settings.KeySMTPPass], "effective 表敏感键回掩码")
	assert.Equal(t, MailModeSMTP, body["mail_mode"])

	raw := w.Body.String()
	assert.NotContains(t, raw, "super-secret", "响应体任何位置不得出现明文")
	assert.NotContains(t, raw, sealx.SealedPrefix, "响应体任何位置不得出现密文串")
}

func TestListMailModeNilAndOAuth(t *testing.T) {
	_, s := newStoreEnvDB(t)

	t.Run("MailModeFn/OAuthInfo 均 nil → mail_mode 空串、无 oauth 字段", func(t *testing.T) {
		mux := http.NewServeMux()
		MountAdmin(mux, AdminDeps{
			Store: s,
			Guard: func(next http.Handler) http.Handler { return next },
			Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		})
		w, body := doJSON(t, mux, http.MethodGet, "/api/admin/settings", "")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "", body["mail_mode"], "nil MailModeFn 统一为空串")
		_, has := body["oauth"]
		assert.False(t, has, "nil OAuthInfo 时 oauth 字段必须省略")
	})

	t.Run("OAuthInfo 非空 → oauth 数组（未配 provider 也返回空数组）", func(t *testing.T) {
		mux := http.NewServeMux()
		MountAdmin(mux, AdminDeps{
			Store: s,
			Guard: func(next http.Handler) http.Handler { return next },
			Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
			OAuthInfo: func() []OAuthProviderInfo {
				return []OAuthProviderInfo{{
					Name:        "google",
					CallbackURL: "https://x.example.com/auth/oauth/google/callback",
				}}
			},
		})
		w, body := doJSON(t, mux, http.MethodGet, "/api/admin/settings", "")
		require.Equal(t, http.StatusOK, w.Code)
		oauth, ok := body["oauth"].([]any)
		require.True(t, ok, "oauth 必须是数组")
		require.Len(t, oauth, 1)
		entry, _ := oauth[0].(map[string]any)
		assert.Equal(t, "google", entry["name"])
		assert.Equal(t, "https://x.example.com/auth/oauth/google/callback", entry["callback_url"])
	})
}

func TestPutSensitiveMaskingIntegration(t *testing.T) {
	pool, s := newStoreEnvDB(t)
	sealed := s.WithSealer(mustTestSecrets(t, 'k'))
	ctx := context.Background()
	var logBuf bytes.Buffer
	mux := passthroughLogMux(t, sealed, &logBuf)

	// 1) 正常写入：响应与审计日志都只出现掩码。
	w, body := doJSON(t, mux, http.MethodPut, "/api/admin/settings/smtp_pass", `{"value":"super-secret"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, settings.MaskedValue, body["value"], "响应体回掩码")
	assert.NotContains(t, w.Body.String(), "super-secret")
	assert.Contains(t, logBuf.String(), settings.MaskedValue)
	assert.NotContains(t, logBuf.String(), "super-secret", "审计日志不得出现明文")
	assert.NotContains(t, logBuf.String(), sealx.SealedPrefix, "审计日志不得出现密文串")
	raw, found, err := sealed.Get(ctx, settings.KeySMTPPass)
	require.NoError(t, err)
	assert.True(t, found)
	assert.True(t, strings.HasPrefix(raw, sealx.SealedPrefix), "落库必须是 sealed 串")

	// 2) 掩码幂等短路：PUT "******" 200 回掩码、不改库、不写日志。
	rawBefore := raw
	logBuf.Reset()
	w, body = doJSON(t, mux, http.MethodPut, "/api/admin/settings/smtp_pass", `{"value":"******"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, settings.MaskedValue, body["value"])
	rawAfter, _, err := sealed.Get(ctx, settings.KeySMTPPass)
	require.NoError(t, err)
	assert.Equal(t, rawBefore, rawAfter, "掩码回写不得改动存储值")
	assert.NotContains(t, logBuf.String(), "admin.setting_change", "短路不得产生变更日志")

	// 3) 无 sealer 的 store 写敏感键 → 500（fail-closed），不留行。
	_, err = pool.Exec(ctx, `DELETE FROM site_settings WHERE key = $1`, settings.KeySMTPPass)
	require.NoError(t, err)
	plain := settings.NewStore(pool)
	muxPlain := passthroughLogMux(t, plain, &bytes.Buffer{})
	w, _ = doJSON(t, muxPlain, http.MethodPut, "/api/admin/settings/smtp_pass", `{"value":"another-secret"}`)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
	_, found, err = plain.Get(ctx, settings.KeySMTPPass)
	require.NoError(t, err)
	assert.False(t, found, "fail-closed 写不得留下 DB 行")

	// 4) 无 DB 的 store：掩码短路发生在任何落库之前 → 200。
	muxEmpty := newTestMux(t, &settings.Store{}, nil, "", nil)
	w, body = doJSON(t, muxEmpty, http.MethodPut, "/api/admin/settings/smtp_pass", `{"value":"******"}`)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, settings.MaskedValue, body["value"])
}

func TestTestEmailLogNoSecretsIntegration(t *testing.T) {
	_, s := newStoreEnvDB(t)
	ctx := context.Background()
	sealed := s.WithSealer(mustTestSecrets(t, 'k'))
	require.NoError(t, sealed.Set(ctx, settings.KeySMTPPass, "super-secret", "ops@x.com"))

	var logBuf bytes.Buffer
	mux := http.NewServeMux()
	MountAdmin(mux, AdminDeps{
		Store:      sealed,
		Guard:      func(next http.Handler) http.Handler { return next },
		Mailer:     &fakeMailer{},
		MailModeFn: func() string { return MailModeSMTP },
		Log:        slog.New(slog.NewTextHandler(&logBuf, nil)),
	})
	w, _ := doJSON(t, mux, http.MethodPost, "/api/admin/settings/test-email", `{"to":"a@b.com"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.NotContains(t, logBuf.String(), "super-secret", "testEmail 日志不得出现敏感值")
	assert.NotContains(t, logBuf.String(), sealx.SealedPrefix)
}

func TestRegisteredKeysAdminSurface(t *testing.T) {
	newStore := func(t *testing.T) *settings.Store {
		t.Helper()
		s := settings.NewStore(nil)
		require.NoError(t, s.RegisterKeys(
			settings.KeySpec{
				Key:         "resend_api_key",
				Description: "Resend API key",
				Sensitive:   true,
				Validate: func(v string) error {
					if v != "" && !strings.HasPrefix(v, "re_") {
						return errBadResendKey
					}
					return nil
				},
			},
			settings.KeySpec{Key: "resend_from", Description: "Resend 发件人"},
		))
		return s
	}

	t.Run("掩码回显 = 不修改（注册敏感键同享约定）", func(t *testing.T) {
		mux := newTestMux(t, newStore(t), nil, "", nil)
		w, body := doJSON(t, mux, http.MethodPut, "/api/admin/settings/resend_api_key", `{"value":"******"}`)
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "******", body["value"])
	})

	t.Run("自定义 Validate 拒绝非法值", func(t *testing.T) {
		mux := newTestMux(t, newStore(t), nil, "", nil)
		w, body := doJSON(t, mux, http.MethodPut, "/api/admin/settings/resend_api_key", `{"value":"not-re-prefixed"}`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Equal(t, "E_VALIDATION", body["error"])
	})

	t.Run("未注册键依旧 400（白名单仍封闭）", func(t *testing.T) {
		mux := newTestMux(t, newStore(t), nil, "", nil)
		w, _ := doJSON(t, mux, http.MethodPut, "/api/admin/settings/rogue_key", `{"value":"x"}`)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}
