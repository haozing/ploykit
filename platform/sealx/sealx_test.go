package sealx

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var (
	testKeyA = []byte("0123456789abcdef0123456789abcdef")
	testKeyB = []byte("fedcba9876543210fedcba9876543210")
)

func TestSealRoundtrip(t *testing.T) {
	s, err := New(testKeyA)
	require.NoError(t, err)

	ct, err := s.Encrypt("sk-live-abcdef0123456789")
	require.NoError(t, err)

	assert.False(t, bytes.Contains(ct, []byte("sk-live")))

	pt, err := s.Decrypt(ct)
	require.NoError(t, err)
	assert.Equal(t, "sk-live-abcdef0123456789", pt)
}

func TestSealTamperRejected(t *testing.T) {
	s, _ := New(testKeyA)
	ct, _ := s.Encrypt("secret")
	ct[len(ct)-1] ^= 0x01
	_, err := s.Decrypt(ct)
	assert.Error(t, err)
}

func TestSealWrongKeyRejected(t *testing.T) {
	a, _ := New(testKeyA)
	b, _ := New(testKeyB)
	ct, _ := a.Encrypt("secret")
	_, err := b.Decrypt(ct)
	assert.Error(t, err)
}

func TestNewKeyLength(t *testing.T) {
	_, err := New([]byte("short"))
	require.Error(t, err, "non-32-byte key must be rejected")
	// v0.14：报错文案带格式指引——64 位 hex 串被 base64 解码后是 48 字节,
	// 是最常见的误配形态,文案必须一步指出正确格式。
	assert.Contains(t, err.Error(), "must be 32 bytes (AES-256)")
	assert.Contains(t, err.Error(), "openssl rand -base64 32")
	assert.Contains(t, err.Error(), "64-char hex string is 48 bytes when base64-decoded")
}
