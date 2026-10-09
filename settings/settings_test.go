package settings

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidate(t *testing.T) {
	cases := []struct {
		name    string
		key     string
		value   string
		wantErr bool
	}{

		{"banner_text 任意文本", KeyBannerText, "今晚 22:00 例行维护", false},
		{"banner_text 空串=无公告", KeyBannerText, "", false},
		{"banner_text 500 字上限内", KeyBannerText, strings.Repeat("公", 500), false},
		{"banner_text 超过 500 字", KeyBannerText, strings.Repeat("公", 501), true},
		{"banner_kind info", KeyBannerKind, "info", false},
		{"banner_kind warn", KeyBannerKind, "warn", false},
		{"banner_kind 非法值", KeyBannerKind, "danger", true},
		{"maintenance_mode 0/1", KeyMaintenanceMode, "1", false},
		{"maintenance_mode 非法值", KeyMaintenanceMode, "true", true},
		{"allow_signup 0/1", KeyAllowSignup, "0", false},
		{"allow_signup 非法值", KeyAllowSignup, "false", true},
		{"allowed_domains 合法", KeyAllowedDomains, "example.com, Corp.example.COM", false},
		{"allowed_domains 空=不限", KeyAllowedDomains, "", false},
		{"allowed_domains 非域名", KeyAllowedDomains, "随便写点什么", true},
		{"allowed_domains 无点", KeyAllowedDomains, "localhost", true},

		{"rate_limit_per_user_per_min 合法", KeyRateLimitPerUserPerMin, "120", false},
		{"rate_limit_per_user_per_min 0=关", KeyRateLimitPerUserPerMin, "0", false},
		{"rate_limit_per_user_per_min 负数", KeyRateLimitPerUserPerMin, "-1", true},
		{"rate_limit_per_user_per_min 非整数", KeyRateLimitPerUserPerMin, "abc", true},
		{"rate_limit_per_ip_per_min 超上限", KeyRateLimitPerIPPerMin, "100001", true},
		{"rate_limit_allowlist 裸 IP", KeyRateLimitAllowlist, "10.0.0.5, 2001:db8::1", false},
		{"rate_limit_allowlist CIDR", KeyRateLimitAllowlist, "192.168.0.0/16, 10.8.0.0/12", false},
		{"rate_limit_allowlist 空=无豁免", KeyRateLimitAllowlist, "", false},
		{"rate_limit_allowlist 非 IP/CIDR", KeyRateLimitAllowlist, "example.com", true},

		{"未知键", "not_a_key", "x", true},
		{"settings 自身不可写整表", "settings", `{"banner_text":"x"}`, true},
		{"空键", "", "x", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := Validate(c.key, c.value)
			if c.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestEnvFlag(t *testing.T) {
	cases := []struct {
		raw    string
		want   string
		wantOK bool
	}{
		{raw: "true", want: "1", wantOK: true},
		{raw: "TRUE", want: "1", wantOK: true},
		{raw: "1", want: "1", wantOK: true},
		{raw: "false", want: "0", wantOK: true},
		{raw: "off", want: "0", wantOK: true},
		{raw: "", want: "", wantOK: false},
		{raw: "junk", want: "", wantOK: false},
	}
	for _, c := range cases {
		got, ok := envFlag(c.raw)
		assert.Equal(t, c.wantOK, ok, "raw=%q", c.raw)
		assert.Equal(t, c.want, got, "raw=%q", c.raw)
	}
}

func TestSplitDomains(t *testing.T) {
	assert.Nil(t, SplitDomains(""))
	assert.Nil(t, SplitDomains(" , ,"))
	assert.Equal(t, []string{"a.com", "b.org"}, SplitDomains("a.com, B.ORG ,,  a.com"))
	assert.Equal(t, []string{"x.io"}, SplitDomains(" x.io "))
}

func TestEffectiveValueFallback(t *testing.T) {
	env := map[string]string{
		"ALLOW_SIGNUP":    "false",
		"ALLOWED_DOMAINS": "corp.com",
	}
	lookup := func(k string) string { return env[k] }
	s := &Store{env: lookup}

	cases := []struct {
		name     string
		key      string
		tableVal string
		found    bool
		envVal   string
		want     string
	}{

		{"表值压过 env", KeyAllowSignup, "1", true, "false", "1"},
		{"表值空串也算数", KeyAllowedDomains, "", true, "corp.com", ""},

		{"env false → 邀请制", KeyAllowSignup, "", false, "false", "0"},
		{"env true → 开放", KeyAllowSignup, "", false, "true", "1"},
		{"env 域名透传", KeyAllowedDomains, "", false, "corp.com,edu.cn", "corp.com,edu.cn"},

		{"env 未设 → 默认开", KeyAllowSignup, "", false, "", "1"},
		{"env 空串 → 默认不限域名", KeyAllowedDomains, "", false, "", ""},

		{"banner_text 无 env 源", KeyBannerText, "", false, "anything", ""},
		{"maintenance 无 env 源", KeyMaintenanceMode, "", false, "1", "0"},

		{"env 不可识别 → 默认", KeyAllowSignup, "", false, "junk", "1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if envOf(c.key) != "" {
				env[envOf(c.key)] = c.envVal
			}
			assert.Equal(t, c.want, s.effectiveValue(c.key, c.tableVal, c.found))
		})
	}

	s2 := NewStore(nil)
	assert.Equal(t, "1", s2.effectiveValue(KeyAllowSignup, "", false))
	assert.Equal(t, "info", s2.effectiveValue(KeyBannerKind, "", false))
}

func TestNormalize(t *testing.T) {
	assert.Equal(t, "info", Normalize(KeyBannerKind, " info "), "非文本键统一 trim")
	assert.Equal(t, "今晚维护", Normalize(KeyBannerText, " 今晚维护 "))
	assert.Equal(t, "a.com,b.com", Normalize(KeyAllowedDomains, " A.com , b.com ,"))
	assert.Equal(t, "10.0.0.5,192.168.0.0/16", Normalize(KeyRateLimitAllowlist, " 10.0.0.5 , 192.168.0.0/16 ,"))
	assert.Equal(t, "120", Normalize(KeyRateLimitPerUserPerMin, " 120 "))
}

func TestRateLimitsUnit(t *testing.T) {

	env := map[string]string{
		"RATE_LIMIT_PER_USER_PER_MIN": "600",
		"RATE_LIMIT_PER_IP_PER_MIN":   "junk",
		"RATE_LIMIT_ALLOWLIST":        "10.0.0.5, 10.0.0.5, 192.168.0.0/16",
	}
	s := &Store{env: func(k string) string { return env[k] }}
	assert.Equal(t, "600", s.effectiveValue(KeyRateLimitPerUserPerMin, "", false))
	assert.Equal(t, "30", s.effectiveValue(KeyRateLimitPerIPPerMin, "", false), "env 坏值 → 默认 30")
	assert.Equal(t, "10.0.0.5, 10.0.0.5, 192.168.0.0/16", s.effectiveValue(KeyRateLimitAllowlist, "", false))

	assert.Equal(t, "0", s.effectiveValue(KeyRateLimitPerUserPerMin, "0", true))

	assert.Equal(t, 600, parsePerMin("600", 0))
	assert.Equal(t, 0, parsePerMin("junk", 0))
	assert.Equal(t, 30, parsePerMin("-5", 30))
	assert.Equal(t, 0, parsePerMin("100001", 0), "超界回落")

	assert.Nil(t, SplitIPAllowlist(""))
	assert.Nil(t, SplitIPAllowlist(" , ,"))
	assert.Equal(t, []string{"10.0.0.5", "192.168.0.0/16"}, SplitIPAllowlist(" 10.0.0.5 , 192.168.0.0/16 ,, 10.0.0.5 "))
}

func newStoreEnv(t *testing.T) (*pgxpool.Pool, *Store) {
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
	require.NoError(t, err, "自建 site_settings（与迁移 038 同 DDL）")
	_, _ = pool.Exec(ctx, `DELETE FROM site_settings`)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM site_settings`) })
	return pool, NewStore(pool)
}

func TestStoreUpsertIntegration(t *testing.T) {
	_, s := newStoreEnv(t)
	ctx := context.Background()

	require.NoError(t, s.Set(ctx, KeyBannerText, "第一版", "a@x.com"))
	v, found, err := s.Get(ctx, KeyBannerText)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "第一版", v)

	require.NoError(t, s.Set(ctx, KeyBannerText, "第二版", "b@x.com"))
	v, found, err = s.Get(ctx, KeyBannerText)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "第二版", v)

	require.NoError(t, s.Set(ctx, KeyMaintenanceMode, "1", "b@x.com"))
	all, err := s.All(ctx)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{KeyBannerText: "第二版", KeyMaintenanceMode: "1"}, all)
}

func TestBootstrapIntegration(t *testing.T) {
	pool, _ := newStoreEnv(t)
	ctx := context.Background()
	env := map[string]string{
		"ALLOW_SIGNUP":    "false",
		"ALLOWED_DOMAINS": "corp.com, edu.cn",
	}
	lookup := func(k string) string { return env[k] }

	s, err := Bootstrap(pool, lookup)
	require.NoError(t, err)
	all, err := s.All(ctx)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{
		KeyBannerText:             "",
		KeyBannerKind:             "info",
		KeyMaintenanceMode:        "0",
		KeyAllowSignup:            "0",
		KeyAllowedDomains:         "corp.com, edu.cn",
		KeyRateLimitPerUserPerMin: "0",
		KeyRateLimitPerIPPerMin:   "30",
		KeyRateLimitAllowlist:     "",
	}, all)

	require.NoError(t, s.Set(ctx, KeyAllowSignup, "1", "ops@x.com"))
	require.NoError(t, s.Set(ctx, KeyBannerText, "周年庆", "ops@x.com"))
	s2, err := Bootstrap(pool, lookup)
	require.NoError(t, err)
	v, found, err := s2.Get(ctx, KeyAllowSignup)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "1", v, "admin 改回的值不被 env 覆盖")
	eff, err := s2.Effective(ctx)
	require.NoError(t, err)
	assert.Equal(t, "周年庆", eff[KeyBannerText])
}

func TestEffectiveAndGateIntegration(t *testing.T) {
	pool, s := newStoreEnv(t)
	ctx := context.Background()

	envOnly := &Store{pool: pool, env: func(k string) string {
		return map[string]string{"ALLOW_SIGNUP": "false", "ALLOWED_DOMAINS": "corp.com"}[k]
	}}
	eff, err := envOnly.Effective(ctx)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{
		KeyBannerText:             "",
		KeyBannerKind:             "info",
		KeyMaintenanceMode:        "0",
		KeyAllowSignup:            "0",
		KeyAllowedDomains:         "corp.com",
		KeyRateLimitPerUserPerMin: "0",
		KeyRateLimitPerIPPerMin:   "30",
		KeyRateLimitAllowlist:     "",
	}, eff)
	allow, domains, err := envOnly.RegistrationGate(ctx)
	require.NoError(t, err)
	assert.False(t, allow, "env ALLOW_SIGNUP=false → 邀请制")
	assert.Equal(t, []string{"corp.com"}, domains)

	require.NoError(t, s.Set(ctx, KeyAllowSignup, "1", "ops@x.com"))
	require.NoError(t, s.Set(ctx, KeyAllowedDomains, " A.COM , b.org ", "ops@x.com"))
	s.env = func(string) string { return "" }
	allow, domains, err = s.RegistrationGate(ctx)
	require.NoError(t, err)
	assert.True(t, allow)
	assert.Equal(t, []string{"a.com", "b.org"}, domains, "域名读法小写规整")

	require.NoError(t, s.Set(ctx, KeyMaintenanceMode, "1", "ops@x.com"))
	on, err := s.Maintenance(ctx)
	require.NoError(t, err)
	assert.True(t, on)

	require.NoError(t, s.Set(ctx, KeyRateLimitPerUserPerMin, "600", "ops@x.com"))
	require.NoError(t, s.Set(ctx, KeyRateLimitAllowlist, " 10.0.0.5 , 192.168.0.0/16 ", "ops@x.com"))
	rlUser, rlIP, rlAllow, err := s.RateLimits(ctx)
	require.NoError(t, err)
	assert.Equal(t, 600, rlUser, "表值 600 压过 env 默认")
	assert.Equal(t, 30, rlIP, "未写键走静态默认 30")
	assert.Equal(t, []string{"10.0.0.5", "192.168.0.0/16"}, rlAllow)
}
