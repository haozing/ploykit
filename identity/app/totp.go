package app

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// RFC 6238 defaults: HMAC-SHA1, 30-second steps, 6 digits, ±1 step drift.
// The drift accepts the previous/next step to absorb client clock skew
// (GitHub and most authenticator apps do the same); a stolen code therefore
// stays valid for at most ~90 seconds.
const (
	totpStep     = 30 * time.Second
	totpDigits   = 6
	totpMaxDrift = 1
)

// GenerateTOTPSecret returns 160 bits of fresh TOTP key material (RFC 4226
// §4 recommends ≥160 bits; all mainstream authenticator apps accept it).
func GenerateTOTPSecret() ([]byte, error) {
	secret := make([]byte, 20)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("generate totp secret: %w", err)
	}
	return secret, nil
}

// TOTPBase32 renders a secret in the unpadded base32 form every
// authenticator app's manual-entry field expects.
func TOTPBase32(secret []byte) string {
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret)
}

// ParseTOTPBase32 decodes the unpadded base32 form back to key material.
func ParseTOTPBase32(encoded string) ([]byte, error) {
	return base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(
		strings.ToUpper(strings.TrimRight(encoded, "=")))
}

// OTPAuthURI builds the otpauth:// enrollment URI (the QR payload the client
// renders): otpauth://totp/<issuer>:<account>?secret=…&issuer=…&algorithm=SHA1&digits=6&period=30
func OTPAuthURI(issuer, account, secretB32 string) string {
	label := url.PathEscape(issuer) + ":" + url.PathEscape(account)
	q := url.Values{}
	q.Set("secret", secretB32)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// TOTPAt computes the code a legitimate authenticator would display for the
// secret at the given instant. Servers never generate user-facing codes in
// production paths — this is the reference computation for tests, seeding,
// and cross-checks.
func TOTPAt(secret []byte, at time.Time) string {
	return totpAt(secret, uint64(at.Unix()/int64(totpStep/time.Second)))
}

// VerifyTOTP checks a 6-digit code against the secret at ±1 step around now
// (constant-time compares; leading zeros accepted — the code is a string).
func VerifyTOTP(secret []byte, code string, now time.Time) bool {
	if len(code) != totpDigits {
		return false
	}
	step := now.Unix() / int64(totpStep/time.Second)
	for drift := int64(-totpMaxDrift); drift <= totpMaxDrift; drift++ {
		if subtle.ConstantTimeCompare([]byte(totpAt(secret, uint64(step+drift))), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

func totpAt(secret []byte, counter uint64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, secret)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	// RFC 4226 §5.3 dynamic truncation
	offset := sum[len(sum)-1] & 0x0f
	bin := (uint32(sum[offset])&0x7f)<<24 |
		uint32(sum[offset+1])<<16 |
		uint32(sum[offset+2])<<8 |
		uint32(sum[offset+3])
	code := bin % 1_000_000
	return fmt.Sprintf("%0*d", totpDigits, code)
}
