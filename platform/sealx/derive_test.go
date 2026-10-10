package sealx

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeriveKey_Deterministic(t *testing.T) {
	a := DeriveKey("master-secret", "credential-sealing")
	b := DeriveKey("master-secret", "credential-sealing")
	assert.True(t, bytes.Equal(a, b), "同输入必须同输出（跨进程/跨实例可复现）")
}

func TestDeriveKey_DomainSeparation(t *testing.T) {
	sealing := DeriveKey("master-secret", "credential-sealing")
	ipHash := DeriveKey("master-secret", "ip-hash")
	assert.False(t, bytes.Equal(sealing, ipHash), "不同 domain 必须得到不同 key（用途隔离）")
}

func TestDeriveKey_BaseSeparation(t *testing.T) {
	a := DeriveKey("master-secret-a", "credential-sealing")
	b := DeriveKey("master-secret-b", "credential-sealing")
	assert.False(t, bytes.Equal(a, b), "不同 base 必须得到不同 key")
}

func TestDeriveKey_Length(t *testing.T) {
	assert.Len(t, DeriveKey("base", "domain"), 32, "输出长度必须满足 New/NewSecrets 的 32 字节要求")
	assert.Len(t, DeriveKey("", ""), 32, "空输入也必须给出 32 字节（纯函数，不校验参数）")
}

func TestDeriveKey_UsableAsSealingKey(t *testing.T) {
	s, err := NewSecrets(DeriveKey("master-secret", "x"))
	require.NoError(t, err, "派生 key 必须是合法的 sealing key")

	sealed, err := s.Seal("tenant-secret-01")
	require.NoError(t, err)
	plain, err := s.Unseal(sealed)
	require.NoError(t, err)
	assert.Equal(t, "tenant-secret-01", plain)
}
