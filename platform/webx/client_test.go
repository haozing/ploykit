package webx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClientMetadata_Injected(t *testing.T) {
	var gotPlatform, gotVersion, gotOS string
	h := ClientMetadata(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	h := ClientMetadata(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPlatform, gotVersion, gotOS = ClientMetadataFrom(r.Context())
	}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, "unknown", gotPlatform)
	assert.Equal(t, "unknown", gotVersion)
	assert.Equal(t, "unknown", gotOS)

	var p, v, o string
	h2 := ClientMetadata(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
