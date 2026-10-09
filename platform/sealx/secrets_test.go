package sealx

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testKey(seed byte) []byte {
	k := make([]byte, 32)
	for i := range k {
		k[i] = seed
	}
	return k
}

func TestSecrets_RoundTrip(t *testing.T) {
	s, err := NewSecrets(testKey(1))
	require.NoError(t, err)

	sealed, err := s.Seal("tenant-secret-01")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(sealed, SealedPrefix), "密文必须带 %s 前缀", SealedPrefix)
	assert.NotContains(t, sealed, "tenant-secret-01", "密文不得含明文")

	plain, err := s.Unseal(sealed)
	require.NoError(t, err)
	assert.Equal(t, "tenant-secret-01", plain)
}

func TestSecrets_SealIsNonDeterministic(t *testing.T) {
	s, err := NewSecrets(testKey(1))
	require.NoError(t, err)
	a, err := s.Seal("same")
	require.NoError(t, err)
	b, err := s.Seal("same")
	require.NoError(t, err)
	assert.NotEqual(t, a, b, "随机 nonce：同明文两次密封不得同密文")
}

func TestSecrets_PlaintextRefused(t *testing.T) {
	s, err := NewSecrets(testKey(1))
	require.NoError(t, err)
	out, err := s.Unseal("legacy-plaintext")
	assert.Empty(t, out)
	require.ErrorIs(t, err, ErrPlaintext, "无前缀明文必须报 ErrPlaintext（不透传）")
}

func TestSecrets_NoneMode(t *testing.T) {
	var s *Secrets

	_, err := s.Seal("x")
	assert.ErrorIs(t, err, ErrNoKey, "无 key 时 Seal 必须明确报错（拒写）")

	out, err := s.Unseal("legacy-plaintext")
	assert.Empty(t, out)
	assert.ErrorIs(t, err, ErrPlaintext)

	out, err = s.Unseal(SealedPrefix + "AAAA")
	assert.Empty(t, out)
	assert.ErrorIs(t, err, ErrNoKey)
}

func TestSecrets_WrongKeyFails(t *testing.T) {
	a, err := NewSecrets(testKey(1))
	require.NoError(t, err)
	b, err := NewSecrets(testKey(2))
	require.NoError(t, err)

	sealed, err := a.Seal("secret")
	require.NoError(t, err)
	out, err := b.Unseal(sealed)
	assert.Empty(t, out)
	assert.Error(t, err, "密钥不符必须报错，不得返回错误明文")
}

func TestSecrets_MalformedSealedValue(t *testing.T) {
	s, err := NewSecrets(testKey(1))
	require.NoError(t, err)

	out, err := s.Unseal(SealedPrefix + "!!!not-base64!!!")
	assert.Empty(t, out)
	assert.Error(t, err, "非 base64 密文必须报错")
}

func TestNewSecretsFromEnv(t *testing.T) {
	t.Run("未设置 → nil,nil（None 形态，启动告警不阻断）", func(t *testing.T) {
		t.Setenv(EnvKey, "")
		s, err := NewSecretsFromEnv()
		require.NoError(t, err)
		assert.Nil(t, s)
	})
	t.Run("合法 key → 可用 Secrets", func(t *testing.T) {
		t.Setenv(EnvKey, "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
		s, err := NewSecretsFromEnv()
		require.NoError(t, err)
		require.NotNil(t, s)
		sealed, err := s.Seal("x")
		require.NoError(t, err)
		plain, err := s.Unseal(sealed)
		require.NoError(t, err)
		assert.Equal(t, "x", plain)
	})
	t.Run("非法 base64 → 报错（坏配置不静默降级）", func(t *testing.T) {
		t.Setenv(EnvKey, "!!!not-base64!!!")
		_, err := NewSecretsFromEnv()
		assert.Error(t, err)
	})
	t.Run("长度 ≠ 32 字节 → 报错", func(t *testing.T) {
		t.Setenv(EnvKey, "short")
		_, err := NewSecretsFromEnv()
		assert.Error(t, err)
	})
}

func TestSecrets_UnsealEmptyString(t *testing.T) {
	s, err := NewSecrets(testKey(1))
	require.NoError(t, err)
	out, err := s.Unseal("")
	assert.Empty(t, out)
	assert.ErrorIs(t, err, ErrPlaintext, "空串无前缀，与明文行同判（注释已言明的取舍）")

	var none *Secrets
	out, err = none.Unseal("")
	assert.Empty(t, out)
	assert.ErrorIs(t, err, ErrPlaintext)
}

func TestSecrets_UnsealEmptyPayload(t *testing.T) {
	s, err := NewSecrets(testKey(1))
	require.NoError(t, err)

	for name, stored := range map[string]string{
		"空 base64 payload": SealedPrefix + base64.StdEncoding.EncodeToString(nil),
		"仅前缀":              SealedPrefix,
	} {
		out, err := s.Unseal(stored)
		assert.Empty(t, out, name)
		assert.Error(t, err, "%s：nonce+ciphertext 长度不足必须拒绝", name)
	}
}

func TestSecrets_NilSealerInside(t *testing.T) {
	s := &Secrets{}
	_, err := s.Seal("x")
	assert.ErrorIs(t, err, ErrNoKey)
	_, err = s.Unseal(SealedPrefix + "QUJD")
	assert.ErrorIs(t, err, ErrNoKey, "前缀命中但无 sealer：ErrNoKey 而非 panic")
}

func TestSecrets_ValidBase64Tampered(t *testing.T) {
	s, err := NewSecrets(testKey(1))
	require.NoError(t, err)
	sealed, err := s.Seal("tenant-secret")
	require.NoError(t, err)

	tampered := sealed[:len(sealed)-1] + "B"
	if tampered == sealed {
		tampered = sealed[:len(sealed)-1] + "A"
	}
	out, err := s.Unseal(tampered)
	assert.Empty(t, out)
	assert.Error(t, err, "合法 base64 的篡改密文必须认证失败")

	plain, err := s.Unseal(sealed)
	require.NoError(t, err)
	assert.Equal(t, "tenant-secret", plain)
}

func TestSealer_NilReceiver(t *testing.T) {
	var s *Sealer
	_, err := s.Encrypt("x")
	assert.ErrorContains(t, err, "not constructed")
	_, err = s.Decrypt([]byte("anything"))
	assert.ErrorContains(t, err, "not constructed")
}
