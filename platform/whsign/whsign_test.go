package whsign

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

var testNow = time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)

func TestSign_DeterministicShape(t *testing.T) {
	sig := Sign("sekret", testNow, []byte(`{"a":1}`))
	assert.Regexp(t, `^sha256=[0-9a-f]{64}$`, sig)
	// same inputs -> same signature; different second -> different signature
	assert.Equal(t, sig, Sign("sekret", testNow, []byte(`{"a":1}`)))
	assert.NotEqual(t, sig, Sign("sekret", testNow.Add(time.Second), []byte(`{"a":1}`)))
	// unix seconds granularity: sub-second differences sign identically
	assert.Equal(t, sig, Sign("sekret", testNow.Add(500*time.Millisecond), []byte(`{"a":1}`)))
}

func TestVerifySign_Roundtrip(t *testing.T) {
	sig := Sign("sekret", testNow, []byte("body"))
	assert.True(t, VerifySign("sekret", testNow, []byte("body"), sig))
	assert.False(t, VerifySign("sekret", testNow, []byte("tampered"), sig))
	assert.False(t, VerifySign("other", testNow, []byte("body"), sig))
}

func TestVerifySignWithWindow(t *testing.T) {
	sig := Sign("sekret", testNow, []byte("body"))
	assert.True(t, VerifySignWithWindow("sekret", testNow, []byte("body"), sig, 5*time.Minute, testNow.Add(4*time.Minute)))
	assert.False(t, VerifySignWithWindow("sekret", testNow, []byte("body"), sig, 5*time.Minute, testNow.Add(6*time.Minute)),
		"outside the replay window must fail even with a valid signature")
	assert.False(t, VerifySignWithWindow("sekret", testNow.Add(10*time.Minute), []byte("body"),
		Sign("sekret", testNow.Add(10*time.Minute), []byte("body")), 5*time.Minute, testNow),
		"future-dated timestamps fail symmetrically")
}

func TestVerifySignAny_Rotation(t *testing.T) {
	old, cur := "old-sekret", "cur-sekret"
	sigOld := Sign(old, testNow, []byte("body"))
	sigCur := Sign(cur, testNow, []byte("body"))
	assert.True(t, VerifySignAny([]string{cur, old}, testNow, []byte("body"), sigCur), "current secret")
	assert.True(t, VerifySignAny([]string{cur, old}, testNow, []byte("body"), sigOld), "old secret inside rotation window")
	assert.True(t, VerifySignAny([]string{cur, ""}, testNow, []byte("body"), sigCur), "empty entries skipped")
	assert.False(t, VerifySignAny([]string{cur, old}, testNow, []byte("body"), "sha256="+strings.Repeat("0", 64)))
}
