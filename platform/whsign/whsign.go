// Package whsign implements the ploykit webhook delivery signature protocol.
//
// It is deliberately a zero-dependency leaf (stdlib only): webhook RECEIVERS —
// independent services that consume ploykit-originated deliveries, such as pack
// integrations — must be able to verify deliveries without importing the
// webhooks business domain or any of ploykit's transitive dependencies. The
// webhooks/app package delegates to this implementation, so sender and
// receivers share one protocol definition and can never drift apart.
//
// # Protocol (for non-Go receivers)
//
// Signature algorithm — HMAC-SHA256 over "<unixSeconds>." + rawBody, hex
// encoded, prefixed "sha256=":
//
//	mac    := HMAC_SHA256(key = subscriptionSecret, msg = unixSeconds + "." + rawBody)
//	header := "sha256=" + hex_lowercase(mac)
//
// Delivery headers:
//
//	X-Signature      current secret's signature (always present)
//	X-Signature-Old  previous secret's signature (present during the 24h rotation window)
//	X-Timestamp      signing time, RFC 3339 with nanoseconds
//	X-Event-Id       stable event id — receivers MUST dedupe on this
//	X-Event-Type     catalog event type
//	X-Delivery-Id    per-attempt delivery id (retry attempts get new ids — dedupe on X-Event-Id, not this)
//
// Verification recipe:
//  1. parse X-Timestamp; reject if |now - ts| exceeds your replay window
//     (ploykit's own receivers use 5 minutes: RecommendedReplayWindow);
//  2. compute the signature per the algorithm above over the RAW request body
//     (before any decoding) with your subscription secret;
//  3. constant-time compare against X-Signature; on failure during a rotation
//     window, compare against X-Signature-Old (VerifyAny handles both);
//  4. dedupe on X-Event-Id — deliveries retry with the same event id.
package whsign

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"
)

// RecommendedReplayWindow is the clock-skew window ploykit's own receivers
// accept for the X-Timestamp check. Receivers may tighten or widen it, but
// should document whatever they choose.
const RecommendedReplayWindow = 5 * time.Minute

// OldSecretTTL is how long a rotated-out secret keeps signing (as
// X-Signature-Old) while receivers update: 24 hours.
const OldSecretTTL = 24 * time.Hour

// Sign returns the X-Signature value for body signed with secret at timestamp:
// "sha256=" + hex(HMAC-SHA256(secret, "<unixSeconds>." + body)).
func Sign(secret string, timestamp time.Time, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(timestamp.Unix(), 10)))
	mac.Write([]byte("."))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// VerifySign reports whether signature matches secret's signature for
// (timestamp, body), in constant time.
func VerifySign(secret string, timestamp time.Time, body []byte, signature string) bool {
	expected := Sign(secret, timestamp, body)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// VerifySignWithWindow is VerifySign plus the replay check: the timestamp must
// be within maxAge of now in either direction. Receivers should call this
// (not bare VerifySign) — an untimed signature is replayable verbatim.
func VerifySignWithWindow(secret string, ts time.Time, body []byte, signature string, maxAge time.Duration, now time.Time) bool {
	if diff := now.Sub(ts); diff > maxAge || diff < -maxAge {
		return false
	}
	return VerifySign(secret, ts, body, signature)
}

// VerifyAny tries each secret (current first, then the old one inside the
// rotation window), skipping empty entries — the receiver-side counterpart of
// the X-Signature / X-Signature-Old dual header.
func VerifySignAny(secrets []string, timestamp time.Time, body []byte, signature string) bool {
	for _, s := range secrets {
		if s == "" {
			continue
		}
		if VerifySign(s, timestamp, body, signature) {
			return true
		}
	}
	return false
}
