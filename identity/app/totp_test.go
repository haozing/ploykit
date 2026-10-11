package app

import (
	"encoding/base32"
	"testing"
	"time"
)

// rfcSecret is the RFC 6238 appendix-B reference secret: the ASCII string
// "12345678901234567890" (20 bytes).
var rfcSecret = []byte("12345678901234567890")

// TestTOTPRFC6238Vectors pins the implementation against the RFC 6238
// appendix-B test vectors (8-digit there; the 6-digit projection is the low
// six digits of each reference value).
func TestTOTPRFC6238Vectors(t *testing.T) {
	// The RFC's 8-digit code is the 31-bit truncation mod 10^8; the 6-digit
	// code is the same truncation mod 10^6 — i.e. the last six digits of the
	// reference value.
	vectors := []struct {
		unix  int64
		code8 string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
		{20000000000, "65353130"},
	}
	for _, v := range vectors {
		want := v.code8[len(v.code8)-6:]
		got := totpAt(rfcSecret, uint64(v.unix/30))
		if got != want {
			t.Errorf("T=%d: got %s, want %s (RFC 8-digit %s)", v.unix, got, want, v.code8)
		}
	}
}

func TestVerifyTOTPAcceptsDriftWindow(t *testing.T) {
	base := time.Unix(1111111111, 0) // exactly on a step boundary
	current := totpAt(rfcSecret, uint64(base.Unix()/30))
	prev := totpAt(rfcSecret, uint64(base.Unix()/30-1))
	next := totpAt(rfcSecret, uint64(base.Unix()/30+1))
	far := totpAt(rfcSecret, uint64(base.Unix()/30+7))

	for _, c := range []string{current, prev, next} {
		if !VerifyTOTP(rfcSecret, c, base) {
			t.Errorf("code %s at step boundaries must verify", c)
		}
	}
	if VerifyTOTP(rfcSecret, far, base) {
		t.Error("code from 7 steps away must not verify (drift is ±1)")
	}
	if VerifyTOTP(rfcSecret, "", base) || VerifyTOTP(rfcSecret, "12345", base) ||
		VerifyTOTP(rfcSecret, "1234567", base) || VerifyTOTP(rfcSecret, "abcdef", base) {
		t.Error("malformed codes must not verify")
	}
}

func TestTOTPBase32RoundTrip(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	encoded := TOTPBase32(secret)
	if len(encoded) != 32 { // 20 bytes → 160 bits → 32 unpadded base32 chars
		t.Fatalf("encoded length = %d, want 32: %s", len(encoded), encoded)
	}
	decoded, err := ParseTOTPBase32(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != string(secret) {
		t.Fatal("base32 round-trip changed the secret")
	}
	// authenticators may paste the padded form — tolerate it
	if _, err := ParseTOTPBase32(encoded + "===="); err != nil {
		t.Fatalf("padded form must parse: %v", err)
	}
	_ = base32.StdEncoding
}

func TestOTPAuthURIShape(t *testing.T) {
	uri := OTPAuthURI("ploykit-example", "user@example.test", "JBSWY3DPEHPK3PXP")
	want := "otpauth://totp/ploykit-example:user@example.test" +
		"?algorithm=SHA1&digits=6&issuer=ploykit-example&period=30&secret=JBSWY3DPEHPK3PXP"
	if uri != want {
		t.Fatalf("uri = %s, want %s", uri, want)
	}
}
