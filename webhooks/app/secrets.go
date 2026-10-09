package app

import (
	"net/http"
	"strings"

	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/platform/webx"
)

const (
	CodeSealKeyMissing = "E_SEAL_KEY_MISSING"

	CodeSealFailed = "E_SEAL_FAILED"
)

type Secrets interface {
	Seal(plain string) (string, error)
	Unseal(stored string) (string, error)
}

func unsealPlaintextErr() error {
	return webx.NewError(http.StatusInternalServerError, CodeSealFailed,
		"webhook secret is stored in plaintext; legacy plaintext support removed 2026-10-07 — recreate the subscription")
}

type noneSecrets struct{}

func (noneSecrets) Seal(string) (string, error) {
	return "", webx.NewError(http.StatusInternalServerError, CodeSealKeyMissing,
		"seal key not configured (set PLOYKIT_SEAL_KEY); refusing to store webhook secret in plaintext")
}

func (noneSecrets) Unseal(stored string) (string, error) {
	if !strings.HasPrefix(stored, sealx.SealedPrefix) {
		return "", unsealPlaintextErr()
	}
	return "", webx.NewError(http.StatusInternalServerError, CodeSealFailed,
		"sealed webhook secret found but seal key not configured (set PLOYKIT_SEAL_KEY)")
}
