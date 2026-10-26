package webx

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClientMetadata_Injected(t *testing.T) {
	var gotPlatform, gotVersion, gotOS string
	h := ClientMetadata()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPlatform, gotVersion, gotOS = ClientMetadataFrom(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderClientPlatform, "web")
	req.Header.Set(HeaderClientVersion, "1.2.3")
	req.Header.Set(HeaderClientOS, "windows")
	h.ServeHTTP(httptest.NewRecorder(), req)
	assert.Equal(t, "web", gotPlatform)
	assert.Equal(t, "1.2.3", gotVersion)
	assert.Equal(t, "windows", gotOS)
}

func TestClientMetadata_MissingUnknown(t *testing.T) {
	var gotPlatform, gotVersion, gotOS string
	h := ClientMetadata()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPlatform, gotVersion, gotOS = ClientMetadataFrom(r.Context())
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, "unknown", gotPlatform)
	assert.Equal(t, "unknown", gotVersion)
	assert.Equal(t, "unknown", gotOS)

	var p, v, o string
	h2 := ClientMetadata()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, v, o = ClientMetadataFrom(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderClientPlatform, "cli")
	h2.ServeHTTP(httptest.NewRecorder(), req)
	assert.Equal(t, "cli", p)
	assert.Equal(t, "unknown", v)
	assert.Equal(t, "unknown", o)
}

func TestClientMetadata_KeysNotForgeable(t *testing.T) {

	p, v, o := ClientMetadataFrom(context.Background())
	assert.Equal(t, "unknown", p)
	assert.Equal(t, "unknown", v)
	assert.Equal(t, "unknown", o)

	ctx := context.WithValue(context.Background(), "X-Client-Platform", "spoofed")
	p, _, _ = ClientMetadataFrom(ctx)
	assert.Equal(t, "unknown", p, "string key injection ineffective")
}

func TestClientIP_InjectedFromRemoteAddr(t *testing.T) {
	var gotIP string
	h := ClientMetadata()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotIP = ClientIPFrom(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.9:51234"
	h.ServeHTTP(httptest.NewRecorder(), req)
	assert.Equal(t, "203.0.113.9", gotIP)
}

func TestClientIP_TrustedProxyResolvesXFF(t *testing.T) {
	_, trusted, err := net.ParseCIDR("10.0.0.0/8")
	require.NoError(t, err)
	var gotIP string
	h := ClientMetadata(trusted)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotIP = ClientIPFrom(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.5:80"
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.9")
	h.ServeHTTP(httptest.NewRecorder(), req)
	// Same resolution as AccessLog's log line: rightmost untrusted XFF hop
	// under a trusted proxy — the ctx carrier and the access log must never
	// disagree about who made the request.
	assert.Equal(t, "203.0.113.7", gotIP)
}

func TestClientIP_UntrustedProxyKeepsRemoteAddr(t *testing.T) {
	_, trusted, err := net.ParseCIDR("10.0.0.0/8")
	require.NoError(t, err)
	var gotIP string
	h := ClientMetadata(trusted)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotIP = ClientIPFrom(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// The proxy at 198.51.100.1 is NOT in the trusted list: a spoofable
	// X-Forwarded-For must be ignored and the socket address recorded.
	req.RemoteAddr = "198.51.100.1:80"
	req.Header.Set("X-Forwarded-For", "203.0.113.7")
	h.ServeHTTP(httptest.NewRecorder(), req)
	assert.Equal(t, "198.51.100.1", gotIP)
}

func TestClientIPFrom_EmptyWithoutMiddleware(t *testing.T) {
	// No ClientMetadata on the chain → "" (there is no unknown sentinel:
	// an address either resolved or it did not).
	assert.Empty(t, ClientIPFrom(context.Background()))

	// The carrier key is unexported and typed: a forged string key cannot
	// seed an IP downstream readers would trust.
	ctx := context.WithValue(context.Background(), "client_ip", "1.2.3.4")
	assert.Empty(t, ClientIPFrom(ctx))

	// WithClientIP round-trips for the non-HTTP seams (tests, replayed
	// requests) that seed the same carrier.
	assert.Equal(t, "192.0.2.10", ClientIPFrom(WithClientIP(context.Background(), "192.0.2.10")))
}
