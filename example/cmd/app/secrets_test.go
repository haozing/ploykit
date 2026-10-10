package main

import (
	"encoding/base64"
	"encoding/hex"
	"testing"

	"github.com/haozing/ploykit/platform/sealx"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func fakeEnv(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestResolveSecrets_ExplicitSealKeyWinsOverMaster(t *testing.T) {
	dec := []byte("0123456789abcdef0123456789abcdef")
	r, err := resolveSecrets(fakeEnv(map[string]string{
		sealx.EnvKey:    base64.StdEncoding.EncodeToString(dec),
		masterSecretEnv: "master-secret",
	}))
	require.NoError(t, err)
	assert.Equal(t, dec, r.SealKey)
	assert.False(t, r.SealFromMaster, "显式 PLOYKIT_SEAL_KEY 必须赢过 master secret")
}

func TestResolveSecrets_ExplicitIPHashWinsOverMaster(t *testing.T) {
	r, err := resolveSecrets(fakeEnv(map[string]string{
		"IP_HASH_SECRET": "explicit-salt",
		masterSecretEnv:  "master-secret",
	}))
	require.NoError(t, err)
	assert.Equal(t, "explicit-salt", r.IPHash)
}

func TestResolveSecrets_MasterFillsBoth(t *testing.T) {
	r, err := resolveSecrets(fakeEnv(map[string]string{masterSecretEnv: "master-secret"}))
	require.NoError(t, err)
	assert.Equal(t, sealx.DeriveKey("master-secret", "credential-sealing"), r.SealKey)
	assert.True(t, r.SealFromMaster)
	assert.Equal(t, hex.EncodeToString(sealx.DeriveKey("master-secret", "ip-hash")), r.IPHash)

	s, err := sealx.NewSecrets(r.SealKey)
	require.NoError(t, err, "派生 key 必须可直接用作 sealing key")
	sealed, err := s.Seal("tenant-secret-01")
	require.NoError(t, err)
	plain, err := s.Unseal(sealed)
	require.NoError(t, err)
	assert.Equal(t, "tenant-secret-01", plain)
}

func TestResolveSecrets_MasterFillsOnlyMissingIPHash(t *testing.T) {
	r, err := resolveSecrets(fakeEnv(map[string]string{
		sealx.EnvKey:     base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
		masterSecretEnv:  "master-secret",
		"IP_HASH_SECRET": "",
	}))
	require.NoError(t, err)
	assert.Equal(t, hex.EncodeToString(sealx.DeriveKey("master-secret", "ip-hash")), r.IPHash,
		"IP_HASH_SECRET 未设置时由 master 派生兜底")
	assert.False(t, r.SealFromMaster)
}

func TestResolveSecrets_NoneSet_KeepsLegacySemantics(t *testing.T) {
	r, err := resolveSecrets(fakeEnv(map[string]string{}))
	require.NoError(t, err)
	assert.Nil(t, r.SealKey, "都不设置 → None 形态（今日行为：NewSecretsFromEnv 告警 + nil）")
	assert.False(t, r.SealFromMaster)
	assert.Empty(t, r.IPHash, "都不设置 → IPHash 空（今日行为：生产 fatal / 开发公共默认）")
}

func TestResolveSecrets_BlankExplicitTreatedAsUnset(t *testing.T) {
	r, err := resolveSecrets(fakeEnv(map[string]string{
		sealx.EnvKey:    "   ",
		masterSecretEnv: "master-secret",
	}))
	require.NoError(t, err)
	assert.True(t, r.SealFromMaster, "空白显式 key 等同未设置（与 NewSecretsFromEnv 的 Trim 语义一致），master 兜底")
}

func TestResolveSecrets_InvalidBase64Fails(t *testing.T) {
	_, err := resolveSecrets(fakeEnv(map[string]string{sealx.EnvKey: "!!!not-base64!!!"}))
	require.Error(t, err, "坏配置必须报错，不得静默降级")
}
