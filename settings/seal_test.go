package settings

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/sealx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mustSecrets(t *testing.T, seed byte) *sealx.Secrets {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = seed
	}
	s, err := sealx.NewSecrets(key)
	require.NoError(t, err)
	return s
}

func TestSealValueUnit(t *testing.T) {
	s := (&Store{}).WithSealer(mustSecrets(t, 'k'))

	sealed, err := s.sealValue(KeySMTPPass, "s3cret")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(sealed, sealx.SealedPrefix), "落库形态必须是 %q 前缀串", sealx.SealedPrefix)
	assert.NotContains(t, sealed, "s3cret", "密文不得包含明文")

	v, err := s.sealValue(KeyBannerText, "hello")
	require.NoError(t, err)
	assert.Equal(t, "hello", v, "非敏感键原样透传")

	ns := &Store{}
	_, err = ns.sealValue(KeySMTPPass, "s3cret")
	require.Error(t, err, "无 sealer 写敏感键必须拒绝（fail-closed）")
	assert.Contains(t, err.Error(), "sealer")
	_, err = ns.sealValue(KeyBannerText, "hello")
	require.NoError(t, err, "无 sealer 不影响非敏感键")
}

func TestSealRoundTripIntegration(t *testing.T) {
	_, s := newStoreEnv(t)
	ctx := context.Background()
	sealed := s.WithSealer(mustSecrets(t, 'k'))

	require.NoError(t, sealed.Set(ctx, KeySMTPPass, "s3cret", "ops@x.com"))
	raw, found, err := sealed.Get(ctx, KeySMTPPass)
	require.NoError(t, err)
	require.True(t, found)
	assert.True(t, strings.HasPrefix(raw, sealx.SealedPrefix), "DB 行必须是 sealed 串，实际 %q", raw)
	assert.NotContains(t, raw, "s3cret")

	_, port, _, pass, _, err := sealed.SMTPConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, 587, port, "未配置的端口走缺省 587")
	assert.Equal(t, "s3cret", pass, "读出时还原明文")

	// 覆盖为空串 = 清除：同样加密落库，读回空。
	require.NoError(t, sealed.Set(ctx, KeySMTPPass, "", "ops@x.com"))
	raw, found, err = sealed.Get(ctx, KeySMTPPass)
	require.NoError(t, err)
	require.True(t, found)
	assert.True(t, strings.HasPrefix(raw, sealx.SealedPrefix))
	_, _, _, pass, _, err = sealed.SMTPConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, "", pass)
}

func TestSensitiveFailClosedIntegration(t *testing.T) {
	pool, s := newStoreEnv(t)
	ctx := context.Background()

	// 无 sealer 写敏感键 → 拒绝且不留 DB 行。
	err := s.Set(ctx, KeySMTPPass, "s3cret", "ops@x.com")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sealer")
	_, found, err := s.Get(ctx, KeySMTPPass)
	require.NoError(t, err)
	assert.False(t, found, "被拒的写不得留下 DB 行")

	// 有 sealer 写入后：
	sealed := s.WithSealer(mustSecrets(t, 'k'))
	require.NoError(t, sealed.Set(ctx, KeySMTPPass, "s3cret", "ops@x.com"))

	// 无 sealer 的 store 读 → 报错（不静默、不回退）。
	reader := NewStore(pool)
	_, err = reader.SiteVerificationMeta(ctx)
	require.NoError(t, err, "非敏感键不受 sealer 缺失影响")
	_, _, _, _, _, err = reader.SMTPConfig(ctx)
	require.Error(t, err)

	// 错误密钥的 store 读 → Unseal 失败报错。
	wrongKey := NewStore(pool).WithSealer(mustSecrets(t, 'x'))
	_, _, _, _, _, err = wrongKey.SMTPConfig(ctx)
	require.Error(t, err)

	// 遗留明文行（直接写入 DB）→ ErrPlaintext，不做明文回退。
	_, err = pool.Exec(ctx, `
		INSERT INTO site_settings (key, value, updated_by) VALUES ($1, $2, 'legacy')
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
		KeySMTPPass, "legacy-plain")
	require.NoError(t, err)
	_, _, _, _, _, err = sealed.SMTPConfig(ctx)
	require.ErrorIs(t, err, sealx.ErrPlaintext)
	assert.False(t, errors.Is(err, ErrNoSealer))
}

func TestSMTPEnvFallbackIntegration(t *testing.T) {
	_, s := newStoreEnv(t)
	ctx := context.Background()
	s.env = func(k string) string {
		return map[string]string{
			"SMTP_HOST": "smtp.example.com",
			"SMTP_PORT": "465",
			"SMTP_PASS": "envpass",
		}[k]
	}

	host, port, _, pass, _, err := s.SMTPConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, "smtp.example.com", host)
	assert.Equal(t, 465, port)
	assert.Equal(t, "envpass", pass, "无 DB 行时 env 明文回退（不入库）")

	// DB 行压过 env。
	require.NoError(t, s.WithSealer(mustSecrets(t, 'k')).Set(ctx, KeySMTPHost, "db.example.com", "ops@x.com"))
	host, _, _, _, _, err = s.SMTPConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, "db.example.com", host)
}

func TestSiteVerificationMetaAccessorIntegration(t *testing.T) {
	_, s := newStoreEnv(t)
	ctx := context.Background()

	v, err := s.SiteVerificationMeta(ctx)
	require.NoError(t, err)
	assert.Equal(t, "", v)

	s.env = func(k string) string {
		return map[string]string{"SITE_VERIFICATION_META": "google-site-verification|env123"}[k]
	}
	v, err = s.SiteVerificationMeta(ctx)
	require.NoError(t, err)
	assert.Equal(t, "google-site-verification|env123", v, "env 回退")

	// DB 行压过 env（落库走归一后的 name|content 对，归一发生在 http put 路径）。
	require.NoError(t, s.Set(ctx, KeySiteVerificationMeta, "google-site-verification|db456", "ops@x.com"))
	v, err = s.SiteVerificationMeta(ctx)
	require.NoError(t, err)
	assert.Equal(t, "google-site-verification|db456", v, "DB 行压过 env，落库为归一对")

	name, content, err := ParseVerificationMeta(v)
	require.NoError(t, err)
	assert.Equal(t, "google-site-verification", name)
	assert.Equal(t, "db456", content)
}

func TestBootstrapSeedableIntegration(t *testing.T) {
	pool, _ := newStoreEnv(t)
	ctx := context.Background()
	env := map[string]string{
		"ALLOW_SIGNUP": "false",
		"SMTP_HOST":    "smtp.example.com",
		"SMTP_PORT":    "465",
		"SMTP_PASS":    "envpass",
	}

	s, err := Bootstrap(pool, func(k string) string { return env[k] })
	require.NoError(t, err)
	all, err := s.All(ctx)
	require.NoError(t, err)
	for _, k := range []string{KeySMTPHost, KeySMTPPort, KeySMTPUser, KeySMTPPass, KeySMTPFrom, KeySiteVerificationMeta} {
		_, found := all[k]
		assert.False(t, found, "新键 %s 不得被 Bootstrap 播种", k)
	}
	assert.Equal(t, "0", all[KeyAllowSignup], "老键照旧首启播种")

	// 未播种 → env 回退在运行期持续生效。
	host, port, _, pass, _, err := s.SMTPConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, "smtp.example.com", host)
	assert.Equal(t, 465, port)
	assert.Equal(t, "envpass", pass)
}

// TestBillingChannelKeysIntegration covers the BC-5 namespace end to end:
// prefix keys Set/Get round-trip sealed, the grouped hot-read unseals,
// and the fail-closed posture (no sealer → write rejected; wrong key →
// read errors) matches smtp_pass.
func TestBillingChannelKeysIntegration(t *testing.T) {
	pool, s := newStoreEnv(t)
	ctx := context.Background()
	bare := NewStore(pool) // 无 sealer 的读/写者（WithSealer 会原地改 s）
	sealed := s.WithSealer(mustSecrets(t, 'k'))

	// 无 sealer 写渠道键 → 拒绝且不留行（fail-closed 同 smtp_pass）。
	err := bare.Set(ctx, BillingChannelKeyPrefix+"waffo.merchant_id", "MER_x", "ops@x.com")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sealer")

	require.NoError(t, sealed.Set(ctx, BillingChannelKeyPrefix+"waffo.merchant_id", "MER_x", "ops@x.com"))
	require.NoError(t, sealed.Set(ctx, BillingChannelKeyPrefix+"waffo.private_key", "k-1", "ops@x.com"))
	require.NoError(t, sealed.Set(ctx, BillingChannelKeyPrefix+"stripe.secret_key", "sk_test_1", "ops@x.com"))

	// Get 返回封存值（密文），BillingChannelFields 返回解封明文并按渠道分组。
	raw, found, err := sealed.Get(ctx, BillingChannelKeyPrefix+"waffo.private_key")
	require.NoError(t, err)
	require.True(t, found)
	assert.True(t, strings.HasPrefix(raw, sealx.SealedPrefix), "DB 行必须是 sealed 串，实际 %q", raw)
	assert.NotContains(t, raw, "k-1")

	fields, err := sealed.BillingChannelFields(ctx)
	require.NoError(t, err)
	assert.Equal(t, map[string]map[string]string{
		"waffo":  {"merchant_id": "MER_x", "private_key": "k-1"},
		"stripe": {"secret_key": "sk_test_1"},
	}, fields)

	// 覆盖 + 清除：空值覆写后字段仍在（presence = 已配置），值为空串。
	require.NoError(t, sealed.Set(ctx, BillingChannelKeyPrefix+"waffo.private_key", "", "ops@x.com"))
	fields, err = sealed.BillingChannelFields(ctx)
	require.NoError(t, err)
	assert.Equal(t, "", fields["waffo"]["private_key"])

	// 前缀外/畸形键不打进分组结果。
	_, err = pool.Exec(ctx, `INSERT INTO site_settings (key, value) VALUES ($1, 'x')`,
		BillingChannelKeyPrefix+"waffo")
	require.NoError(t, err)
	fields, err = sealed.BillingChannelFields(ctx)
	require.NoError(t, err)
	_, has := fields["waffo"][""]
	assert.False(t, has, "缺字段段的畸形键不得产生空字段项")

	// 错误密钥读 → 毒行跳过 + 部分结果 + nil error（fix #5：单行解封失败只废
	// 该行所属渠道，不再整读报错炸掉全渠道；该值绝不返回、绝不回退明文）。
	wrongKey := NewStore(pool).WithSealer(mustSecrets(t, 'x'))
	fields, err = wrongKey.BillingChannelFields(ctx)
	require.NoError(t, err, "fix #5：解封失败改为跳过毒行，不再让整读报错")
	assert.NotContains(t, fields, "waffo", "该密钥不可解的渠道整组跳过")
	assert.NotContains(t, fields, "stripe", "同上")

	// 无 sealer 的 store 读含封存行 → 同样跳过（毒行语义一致）。
	fields, err = bare.BillingChannelFields(ctx)
	require.NoError(t, err)
	assert.NotContains(t, fields, "waffo")
	assert.NotContains(t, fields, "stripe")
}

// TestSetManyIntegration covers fix #11: multi-key writes land in ONE
// transaction — all keys present after success, nothing persisted when any
// seal/validation fails up front, and an empty map is a no-op.
func TestSetManyIntegration(t *testing.T) {
	pool, _ := newStoreEnv(t)
	ctx := context.Background()
	sealed := NewStore(pool).WithSealer(mustSecrets(t, 'k'))
	bare := NewStore(pool)

	require.NoError(t, bare.SetMany(ctx, map[string]string{KeyBannerText: "x"}, "ops@x.com"),
		"非敏感键无 sealer 也可批量写")

	require.NoError(t, sealed.SetMany(ctx, map[string]string{
		BillingChannelKeyPrefix + "waffo.merchant_id": "MER_1",
		BillingChannelKeyPrefix + "waffo.private_key": "k-2",
		KeyBannerText:                                 "批量",
	}, "ops@x.com"))
	v, found, err := sealed.Get(ctx, BillingChannelKeyPrefix+"waffo.merchant_id")
	require.NoError(t, err)
	require.True(t, found)
	assert.True(t, strings.HasPrefix(v, sealx.SealedPrefix), "敏感键落库必须是封存串")
	fields, err := sealed.BillingChannelFields(ctx)
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"merchant_id": "MER_1", "private_key": "k-2"}, fields["waffo"],
		"整批写入后全部键可读")

	// 无 sealer 写敏感键 → 整批拒绝，同批非敏感键也不得落库（seal 预检先行，
	// 事务未开即拒绝）。用非播种键（smtp_host 不被 Bootstrap 播种）作探针。
	err = bare.SetMany(ctx, map[string]string{
		KeySMTPHost:                                     "should-not-land",
		BillingChannelKeyPrefix + "setmany.merchant_id": "MER_x",
	}, "ops@x.com")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNoSealer, "哨兵可 errors.Is（billing 侧经 sealx.ErrNoKey 分类 → 503）")
	_, found, err = bare.Get(ctx, KeySMTPHost)
	require.NoError(t, err)
	assert.False(t, found, "seal 预检失败时事务未开，同批非敏感键零落库")
	_, found, err = bare.Get(ctx, BillingChannelKeyPrefix+"setmany.merchant_id")
	require.NoError(t, err)
	assert.False(t, found)

	// 空批量 = no-op。
	require.NoError(t, sealed.SetMany(ctx, map[string]string{}, "ops@x.com"))
}
