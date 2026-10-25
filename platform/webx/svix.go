package webx

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Svix inbound-webhook signature verification (shuijing field report,
// 2026-10-25). Svix is the signing scheme behind Resend, Clerk and a wide
// slice of the SaaS ecosystem; until now every consumer re-implemented it per
// provider (or pulled github.com/svix/svix-webhooks for ~30 lines).
//
// Scheme: signed_content = "<svix-id>.<svix-timestamp>.<raw body>", keyed with
// HMAC-SHA256; the secret is "whsec_" + base64(key); the svix-signature header
// carries space-separated versioned candidates "v1,<base64 sig>" — any v1
// candidate matching in constant time passes. Timestamps outside ±5 minutes
// are rejected as replays.

// SvixTolerance is the allowed clock skew between the svix-timestamp header
// and the receiver's clock. The Svix standard is five minutes.
const SvixTolerance = 5 * time.Minute

// SvixHeaders extracts the Svix signing triple from a request. Missing
// headers come back as empty strings; SvixVerify then fails.
func SvixHeaders(r *http.Request) (msgID, timestamp, signature string) {
	return r.Header.Get("svix-id"), r.Header.Get("svix-timestamp"), r.Header.Get("svix-signature")
}

// SvixVerify reports whether the Svix signature triple authenticates body at
// the current time. secret is the endpoint's signing secret in the usual
// "whsec_<base64>" form (raw base64 without the prefix is accepted too).
func SvixVerify(secret, msgID, timestamp, signature string, body []byte) bool {
	return svixVerifyAt(secret, msgID, timestamp, signature, body, time.Now())
}

func svixVerifyAt(secret, msgID, timestamp, signature string, body []byte, now time.Time) bool {
	if msgID == "" || timestamp == "" || signature == "" {
		return false
	}
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	skew := now.Sub(time.Unix(ts, 0))
	if skew > SvixTolerance || skew < -SvixTolerance {
		return false
	}
	key, err := svixKey(secret)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(msgID))
	mac.Write([]byte("."))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	want := mac.Sum(nil)
	for _, cand := range strings.Fields(signature) {
		version, sig, ok := strings.Cut(cand, ",")
		if !ok || version != "v1" {
			continue
		}
		got, err := base64.StdEncoding.DecodeString(sig)
		if err != nil {
			continue
		}
		if subtle.ConstantTimeCompare(got, want) == 1 {
			return true
		}
	}
	return false
}

// svixKey decodes the whsec-form secret to the raw HMAC key.
func svixKey(secret string) ([]byte, error) {
	secret = strings.TrimPrefix(secret, "whsec_")
	return base64.StdEncoding.DecodeString(secret)
}
