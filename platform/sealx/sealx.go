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
