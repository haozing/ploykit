package sealx

import (
	"crypto/hmac"
	"crypto/sha256"
)

// DeriveKey derives a 32-byte, domain-separated key from a base secret via
// HMAC-SHA256. Use it to derive per-purpose keys (e.g. credential sealing,
// IP-hash salt) from a single configured master secret; the output length
// matches New/NewSecrets requirements.
func DeriveKey(base, domain string) []byte {
	m := hmac.New(sha256.New, []byte(base))
	m.Write([]byte(domain))
	return m.Sum(nil)
}
