package sealx

import (
	"encoding/base64"
	"errors"
	"log/slog"
	"os"
	"strings"
)

const SealedPrefix = "sealed:v1:"

const EnvKey = "PLOYKIT_SEAL_KEY"

var ErrNoKey = errors.New("sealx: seal key not configured (set " + EnvKey + "); refusing to store plaintext")

var ErrPlaintext = errors.New("sealx: value is not sealed (no " + SealedPrefix + " prefix); legacy plaintext support removed 2026-10-07 — reconfigure the credential")

type Secrets struct{ sealer *Sealer }

func NewSecrets(key []byte) (*Secrets, error) {
	s, err := New(key)
	if err != nil {
		return nil, err
	}
	return &Secrets{sealer: s}, nil
}

func NewSecretsFromEnv() (*Secrets, error) {
	v := strings.TrimSpace(os.Getenv(EnvKey))
	if v == "" {
		slog.Warn("sealx: "+EnvKey+" not set; sealed writes will be rejected and unsealed reads will fail", "prefix", SealedPrefix)
		return nil, nil
	}
	key, err := base64.StdEncoding.DecodeString(v)
	if err != nil {
		return nil, errors.New("sealx: " + EnvKey + " is not valid base64: " + err.Error())
	}
	return NewSecrets(key)
}

func (s *Secrets) Seal(plain string) (string, error) {
	if s == nil || s.sealer == nil {
		return "", ErrNoKey
	}
	blob, err := s.sealer.Encrypt(plain)
	if err != nil {
		return "", err
	}
	return SealedPrefix + base64.StdEncoding.EncodeToString(blob), nil
}

func (s *Secrets) Unseal(stored string) (string, error) {
	if !strings.HasPrefix(stored, SealedPrefix) {
		return "", ErrPlaintext
	}
	if s == nil || s.sealer == nil {
		slog.Warn("sealx: sealed value found but no seal key configured")
		return "", ErrNoKey
	}
	blob, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, SealedPrefix))
	if err != nil {
		slog.Warn("sealx: sealed value is not valid base64")
		return "", errors.New("sealx: sealed value malformed")
	}
	plain, err := s.sealer.Decrypt(blob)
	if err != nil {
		slog.Warn("sealx: unseal failed (key mismatch or corrupted ciphertext)")
		return "", err
	}
	return plain, nil
}
