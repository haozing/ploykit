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
	assert.Error(t, err)
}
