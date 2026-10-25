package settings

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func specFixture() KeySpec {
	return KeySpec{
		Key:         "resend_api_key",
		Description: "Resend API key：保存后仅以掩码回显；落库前经 PLOYKIT_SEAL_KEY 加密",
		Sensitive:   true,
		Env:         "RESEND_API_KEY",
	}
}

func TestRegisterKeys(t *testing.T) {
	t.Run("合法 spec 注册成功", func(t *testing.T) {
		s := &Store{}
		require.NoError(t, s.RegisterKeys(specFixture()))
		_, ok := s.specOf("resend_api_key")
		assert.True(t, ok)
		assert.Equal(t, []string{"resend_api_key"}, s.registeredKeys())
	})

	t.Run("多个键按注册顺序列出", func(t *testing.T) {
		s := &Store{}
		require.NoError(t, s.RegisterKeys(
			KeySpec{Key: "alpha_key"},
			KeySpec{Key: "beta_key", Default: "b"},
		))
		assert.Equal(t, []string{"alpha_key", "beta_key"}, s.registeredKeys())
	})

	t.Run("键形状非法拒绝", func(t *testing.T) {
		for _, bad := range []string{"", "1abc", "Has-Upper", "with.dot", "with space", strings.Repeat("k", 65), "billing_channel.x.y"} {
			s := &Store{}
			err := s.RegisterKeys(KeySpec{Key: bad})
			require.Error(t, err, "key=%q", bad)
			assert.Contains(t, err.Error(), bad)
		}
	})

	t.Run("内置键冲突拒绝", func(t *testing.T) {
		s := &Store{}
		err := s.RegisterKeys(KeySpec{Key: KeySMTPPass})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "built-in")
	})

	t.Run("重复注册拒绝", func(t *testing.T) {
		s := &Store{}
		require.NoError(t, s.RegisterKeys(specFixture()))
		err := s.RegisterKeys(specFixture())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "already registered")
	})

	t.Run("Env 形状非法拒绝", func(t *testing.T) {
		s := &Store{}
		err := s.RegisterKeys(KeySpec{Key: "ok_key", Env: "lower-env"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "env")
	})

	t.Run("批量中第一个非法即拒绝且不部分注册", func(t *testing.T) {
		s := &Store{}
		err := s.RegisterKeys(KeySpec{Key: "good_key"}, KeySpec{Key: "BAD"})
		require.Error(t, err)
		_, ok := s.specOf("good_key")
		assert.False(t, ok, "失败的批次不得留下部分注册")
	})
}

func TestStoreValidateRegistered(t *testing.T) {
	t.Run("nil Validate = 通用 8192 上限", func(t *testing.T) {
		s := &Store{}
		require.NoError(t, s.RegisterKeys(KeySpec{Key: "plain_key"}))
		assert.NoError(t, s.Validate("plain_key", strings.Repeat("a", 8192)))
		assert.Error(t, s.Validate("plain_key", strings.Repeat("a", 8193)))
	})

	t.Run("自定义 Validate 生效", func(t *testing.T) {
		s := &Store{}
		require.NoError(t, s.RegisterKeys(KeySpec{
			Key: "mode_key",
			Validate: func(v string) error {
				if v != "a" && v != "b" {
					return errors.New("must be a|b")
				}
				return nil
			},
		}))
		assert.NoError(t, s.Validate("mode_key", "a"))
		assert.Error(t, s.Validate("mode_key", "c"))
	})

	t.Run("包级 Validate 仍是封闭白名单", func(t *testing.T) {
		require.Error(t, Validate("resend_api_key", "x"), "无 Store 的调用方不得能写任意键")
	})
}

func TestStoreSensitivityAndSealing(t *testing.T) {
	t.Run("注册敏感键 store 级敏感", func(t *testing.T) {
		s := &Store{}
		require.NoError(t, s.RegisterKeys(specFixture()))
		assert.True(t, s.IsSensitive("resend_api_key"))
		assert.False(t, IsSensitive("resend_api_key"), "包级判定只覆盖内置键（文档化分界）")
	})

	t.Run("注册普通键不敏感", func(t *testing.T) {
		s := &Store{}
		require.NoError(t, s.RegisterKeys(KeySpec{Key: "plain_key"}))
		assert.False(t, s.IsSensitive("plain_key"))
	})

	t.Run("注册敏感键落库密封、无 sealer 拒绝", func(t *testing.T) {
		sealed := (&Store{}).WithSealer(mustSecrets(t, 'r'))
		require.NoError(t, sealed.RegisterKeys(specFixture()))

		v, err := sealed.sealValue("resend_api_key", "re_123")
		require.NoError(t, err)
		assert.Contains(t, v, "sealed:v1:")
		assert.NotContains(t, v, "re_123")

		noSealer := &Store{}
		require.NoError(t, noSealer.RegisterKeys(specFixture()))
		_, err = noSealer.sealValue("resend_api_key", "re_123")
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrNoSealer)
	})
}

func TestStoreNormalizeRegistered(t *testing.T) {
	s := &Store{}
	require.NoError(t, s.RegisterKeys(
		KeySpec{Key: "trim_key"},
		KeySpec{Key: "norm_key", Normalize: func(v string) string { return strings.ToLower(v) }},
	))
	assert.Equal(t, "x", s.Normalize("trim_key", "  x  "), "nil Normalize = TrimSpace")
	assert.Equal(t, "abc", s.Normalize("norm_key", "ABC"))
	assert.Equal(t, "banner", s.Normalize(KeyBannerText, " banner "), "内置键走原路径")
}

func TestDescriptionsAndDefaultsMerge(t *testing.T) {
	s := &Store{}
	require.NoError(t, s.RegisterKeys(
		KeySpec{Key: "resend_api_key", Description: "API key", Sensitive: true},
		KeySpec{Key: "resend_from", Description: "发件人", Default: "no-reply@example.com"},
	))
	desc := s.Descriptions()
	assert.Equal(t, "API key", desc["resend_api_key"])
	assert.Equal(t, Descriptions[KeySMTPHost], desc[KeySMTPHost], "内置描述保留")

	defs := s.DefaultsMap()
	assert.Equal(t, "no-reply@example.com", defs["resend_from"])
	assert.Equal(t, Defaults[KeySMTPPort], defs[KeySMTPPort], "内置缺省保留")
}

func TestEffectiveSpecValue(t *testing.T) {
	t.Run("env 回退活着直到 DB 有行", func(t *testing.T) {
		s := &Store{env: func(name string) string {
			if name == "RESEND_API_KEY" {
				return "re_env_live"
			}
			return ""
		}}
		require.NoError(t, s.RegisterKeys(specFixture()))
		assert.Equal(t, "re_env_live", s.effectiveValue("resend_api_key", "", false))
		assert.Equal(t, "re_db_row", s.effectiveValue("resend_api_key", "re_db_row", true), "DB 行永远赢")
	})

	t.Run("env 缺省/空白 → spec Default", func(t *testing.T) {
		s := &Store{env: func(string) string { return "   " }}
		require.NoError(t, s.RegisterKeys(KeySpec{Key: "resend_from", Env: "RESEND_FROM", Default: "noreply@example.com"}))
		assert.Equal(t, "noreply@example.com", s.effectiveValue("resend_from", "", false))
	})

	t.Run("无 env 回退无缺省 = 空串", func(t *testing.T) {
		s := &Store{}
		require.NoError(t, s.RegisterKeys(specFixture()))
		assert.Equal(t, "", s.effectiveValue("resend_api_key", "", false))
	})
}
