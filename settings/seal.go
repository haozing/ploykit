package settings

import (
	"errors"
	"fmt"

	"github.com/haozing/ploykit/platform/sealx"
)

// errNoSealer is returned when a sensitive key is written without a
// configured sealer. Fail-closed by design: no plaintext credential ever
// lands in the generic site_settings table — PLOYKIT_SEAL_KEY unset means
// sensitive writes are rejected, not degraded (AGENTS.md sealx constraint).
var errNoSealer = errors.New("settings: sensitive key requires a configured sealer (PLOYKIT_SEAL_KEY)")

// WithSealer attaches the credential sealer used to encrypt sensitive keys
// (v1: smtp_pass) at rest. Call it once after Bootstrap/NewStore and before
// the first admin write; returns the store for chaining. Build the argument
// with sealx.NewSecretsFromEnv() (nil when PLOYKIT_SEAL_KEY is unset —
// sensitive writes then stay rejected and reads of stored rows error, which
// is the intended posture).
//
// Sealing lives on the Store rather than on the HTTP adapter on purpose: it
// is a storage property, and every writer (admin UI today, product code
// tomorrow) gets the same guarantee.
func (s *Store) WithSealer(secrets *sealx.Secrets) *Store {
	s.sealer = secrets
	return s
}

// sealValue seals value when key is sensitive; plain keys pass through.
func (s *Store) sealValue(key, value string) (string, error) {
	if !IsSensitive(key) {
		return value, nil
	}
	if s.sealer == nil {
		return "", errNoSealer
	}
	sealed, err := s.sealer.Seal(value)
	if err != nil {
		return "", fmt.Errorf("settings: seal %s: %w", key, err)
	}
	return sealed, nil
}
