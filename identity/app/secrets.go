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

func unsealPlaintextErr() error {
	return webx.NewError(http.StatusInternalServerError, CodeSealFailed,
		"credential is stored in plaintext; legacy plaintext support removed 2026-10-07 — reconfigure the workspace SSO client_secret")
}

type Secrets interface {
	Seal(plain string) (string, error)
	Unseal(stored string) (string, error)
}

type noneSecrets struct{}

func (noneSecrets) Seal(string) (string, error) {
	return "", webx.NewError(http.StatusInternalServerError, CodeSealKeyMissing,
		"seal key not configured (set PLOYKIT_SEAL_KEY); refusing to store client_secret in plaintext")
}

func (noneSecrets) Unseal(stored string) (string, error) {
	if !strings.HasPrefix(stored, sealx.SealedPrefix) {
		return "", unsealPlaintextErr()
	}
	return "", webx.NewError(http.StatusInternalServerError, CodeSealFailed,
		"sealed client_secret found but seal key not configured (set PLOYKIT_SEAL_KEY)")
}
