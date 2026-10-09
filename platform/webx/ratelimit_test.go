package webx

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func reqWith(remote, xff string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remote
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	return r
}

func TestParseTrustedProxies(t *testing.T) {
	assert.Nil(t, ParseTrustedProxies(""), "empty = never trust XFF")
	assert.Nil(t, ParseTrustedProxies("  "), "whitespace only equals empty")

	nets := ParseTrustedProxies("10.0.0.0/8, 192.168.1.0/24,bad-cidr, ,172.16.0.0/12")
	require.Len(t, nets, 3, "invalid items skipped, valid items kept")
	assert.True(t, nets[0].Contains(net.ParseIP("10.1.2.3")))
	assert.True(t, nets[1].Contains(net.ParseIP("192.168.1.9")))
	assert.True(t, nets[2].Contains(net.ParseIP("172.31.0.1")))

	assert.Empty(t, ParseTrustedProxies("nope,still-nope"))
}

func TestClientIP_TrustMatrix(t *testing.T) {
	_, trusted, err := net.ParseCIDR("10.0.0.0/8")
	require.NoError(t, err)

	t.Run("direct connection without trusted proxy: RemoteAddr only", func(t *testing.T) {
		r := reqWith("203.0.113.7:44321", "198.51.100.9")
		assert.Equal(t, "203.0.113.7", ClientIP(r))
	})

	t.Run("trusted proxy+XFF: takes the XFF client", func(t *testing.T) {
		r := reqWith("10.1.2.3:9000", "203.0.113.7")
		assert.Equal(t, "203.0.113.7", ClientIP(r, trusted))
	})

	t.Run("forged XFF not trusted: direct non-proxy connection, XFF ignored", func(t *testing.T) {

		r := reqWith("203.0.113.99:5555", "1.1.1.1")
		assert.Equal(t, "203.0.113.99", ClientIP(r, trusted))
	})

	t.Run("multi-hop: rightmost non-trusted", func(t *testing.T) {

		r := reqWith("10.0.0.5:80", "203.0.113.7, 10.2.3.4, 10.3.4.5")
		assert.Equal(t, "203.0.113.7", ClientIP(r, trusted))
	})

	t.Run("XFF all trusted: falls back to RemoteAddr", func(t *testing.T) {

		r := reqWith("10.0.0.5:80", "10.2.3.4, 10.3.4.5")
		assert.Equal(t, "10.0.0.5", ClientIP(r, trusted))
	})

	t.Run("XFF has invalid entries: skip and continue leftward", func(t *testing.T) {
		r := reqWith("10.0.0.5:80", "garbage, 203.0.113.7")
		assert.Equal(t, "203.0.113.7", ClientIP(r, trusted))
	})

	t.Run("RemoteAddr normalized form", func(t *testing.T) {

		r := reqWith("[::ffff:203.0.113.7]:9999", "")
		assert.Equal(t, "203.0.113.7", ClientIP(r))

		r2 := httptest.NewRequest(http.MethodGet, "/", nil)
		r2.RemoteAddr = "203.0.113.8"
		assert.Equal(t, "203.0.113.8", ClientIP(r2))
	})
}

func TestClientIP_RateLimitKeyUsesParsedIP(t *testing.T) {
	_, trusted, err := net.ParseCIDR("10.0.0.0/8")
	require.NoError(t, err)
	lim := &recordingLimiter{}
	h := RateLimit(lim, "sendcode-ip", 10, func(r *http.Request) string {
		return ClientIP(r, trusted)
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	h.ServeHTTP(httptest.NewRecorder(), reqWith("10.0.0.5:80", "203.0.113.7"))
	require.Len(t, lim.keys, 1)
	assert.Equal(t, "rl:sendcode-ip:203.0.113.7", lim.keys[0], "rate-limit key = resolved client IP")
}

type recordingLimiter struct{ keys []string }

func (f *recordingLimiter) Allow(_ context.Context, key string, _ int) (bool, time.Duration) {
	f.keys = append(f.keys, key)
	return true, 0
}
