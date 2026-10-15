// Package sealx seals tenant credentials at rest with AES-256-GCM
// (authenticate-then-store; the sealed form carries an authenticated
// timestamp blob, base64-encoded under the SealedPrefix).
//
// # Key format — three layers, read before the first "invalid key" error
//
//   - New / NewSecrets take 32 RAW bytes (AES-256 key, not hex, not base64 —
//     the []byte IS the key material).
//   - NewSecretsFromEnv reads PLOYKIT_SEAL_KEY and expects that value to be
//     base64 (StdEncoding) of the 32 raw bytes — i.e. the direct output of
//     `openssl rand -base64 32` works as-is.
//   - DeriveKey(base, domain) produces 32 raw bytes from a configured master
//     secret (HMAC-SHA256, domain-separated) — its output feeds New/NewSecrets
//     directly with no encoding step.
//
// Failure posture (deliberate, see AGENTS.md): no key configured = new sealed
// writes are rejected and unsealed reads of legacy plaintext error out —
// there is no plaintext fallback; such credentials must be reconfigured.
package sealx

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
)

type Sealer struct {
	aead cipher.AEAD
}

func New(key []byte) (*Sealer, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("sealx: master key must be 32 bytes (AES-256), got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Sealer{aead: aead}, nil
}

func (s *Sealer) Encrypt(plaintext string) ([]byte, error) {
	if s == nil {
		return nil, errors.New("sealx: sealer not constructed")
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.aead.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func (s *Sealer) Decrypt(blob []byte) (string, error) {
	if s == nil {
		return "", errors.New("sealx: sealer not constructed")
	}
	ns := s.aead.NonceSize()
	if len(blob) < ns+1 {
		return "", errors.New("sealx: invalid ciphertext length")
	}
	pt, err := s.aead.Open(nil, blob[:ns], blob[ns:], nil)
	if err != nil {
		return "", errors.New("sealx: decryption failed (master key mismatch or corrupted ciphertext)")
	}
	return string(pt), nil
}
