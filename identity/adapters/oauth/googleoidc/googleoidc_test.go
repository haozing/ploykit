package googleoidc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func fakeGoogle(t *testing.T, h http.HandlerFunc) (tokenURL, apiBase string) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv.URL + "/token", srv.URL
}

func TestAuthURL(t *testing.T) {
	p := New("cid", "secret")
	got := p.AuthURL("abc123", "http://localhost:8030/auth/oauth/google/callback")
	want := "https://accounts.google.com/o/oauth2/v2/auth" +
		"?response_type=code" +
		"&scope=openid%20email%20profile" +
		"&client_id=cid" +
		"&redirect_uri=" + url.QueryEscape("http://localhost:8030/auth/oauth/google/callback") +
		"&state=abc123"
	assert.Equal(t, want, got)
}

func TestExchange_HappyPath(t *testing.T) {
	var gotAuth string
	tokenURL, apiBase := fakeGoogle(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/token":

			assert.Equal(t, http.MethodPost, r.Method)
			require.NoError(t, r.ParseForm())
			assert.Equal(t, "authorization_code", r.PostFormValue("grant_type"))
			assert.Equal(t, "the-code", r.PostFormValue("code"))
			assert.Equal(t, "cid", r.PostFormValue("client_id"))
			assert.Equal(t, "secret", r.PostFormValue("client_secret"))
			assert.Equal(t, "http://localhost:8030/auth/oauth/google/callback", r.PostFormValue("redirect_uri"))
			_, _ = w.Write([]byte(`{"access_token":"ya29.tok","id_token":"eyJhbGciOiJub25lIn0.e30.e30"}`))
		case "/v1/userinfo":
			gotAuth = r.Header.Get("Authorization")
			_, _ = w.Write([]byte(`{"sub":"1234567890","email":"jane@example.com","email_verified":true,"name":"Jane Doe"}`))
		default:
			http.NotFound(w, r)
		}
	})

	p := New("cid", "secret")
	p.setBaseURLs("https://accounts.google.com/o/oauth2/v2/auth", tokenURL, apiBase)

	id, err := p.Exchange(context.Background(), "the-code", "http://localhost:8030/auth/oauth/google/callback")
	require.NoError(t, err)
	assert.Equal(t, "Bearer ya29.tok", gotAuth, "userinfo 端点必须带 Bearer token")
	assert.Equal(t, "google", id.Provider)
	assert.Equal(t, "1234567890", id.Subject)
	assert.Equal(t, "jane@example.com", id.Email)
	assert.Equal(t, "Jane Doe", id.Name)
	assert.True(t, id.EmailVerified)
}

func TestExchange_Errors(t *testing.T) {
	tests := []struct {
		name    string
		handler func(w http.ResponseWriter, r *http.Request)
	}{
		{"token 端点 500", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "boom", http.StatusInternalServerError)
		}},
		{"token 200 但无 access_token", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		}},
		{"userinfo 缺 sub", func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/token":
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"access_token":"ya29.tok"}`))
			case "/v1/userinfo":
				_, _ = w.Write([]byte(`{"email":"jane@example.com","email_verified":true}`))
			default:
				http.NotFound(w, r)
			}
		}},
		{"userinfo 缺 email", func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/token":
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"access_token":"ya29.tok"}`))
			case "/v1/userinfo":
				_, _ = w.Write([]byte(`{"sub":"1234567890"}`))
			default:
				http.NotFound(w, r)
			}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tokenURL, apiBase := fakeGoogle(t, tt.handler)
			p := New("cid", "secret")
			p.setBaseURLs("https://accounts.google.com/o/oauth2/v2/auth", tokenURL, apiBase)
			id, err := p.Exchange(context.Background(), "code", "http://localhost:8030/cb")
			require.Error(t, err)
			assert.Equal(t, "google", p.Name())
			assert.Empty(t, id.Email)
		})
	}
}

type rtGoogle struct {
	hits int
	err  error
}

func (rt *rtGoogle) RoundTrip(*http.Request) (*http.Response, error) {
	rt.hits++
	return nil, rt.err
}

func TestWithHTTPClient_EG5(t *testing.T) {
	p := New("cid", "secret")
	if p.hc.Timeout != 10*time.Second {
		t.Fatalf("默认 client 应自带 10s 超时, got %v", p.hc.Timeout)
	}

	rt := &rtGoogle{err: errors.New("egress-injected-sentinel")}
	p.WithHTTPClient(&http.Client{Transport: rt})
	_, err := p.Exchange(context.Background(), "code", "http://localhost:8030/cb")
	if err == nil || !strings.Contains(err.Error(), "egress-injected-sentinel") {
		t.Fatalf("Exchange 应走注入的 client（哨兵错误透传）, got %v", err)
	}
	if rt.hits == 0 {
		t.Fatal("注入的 Transport 必须被触达")
	}

	p2 := New("cid", "secret")
	before := p2.hc
	p2.WithHTTPClient(nil)
	if p2.hc != before {
		t.Fatal("WithHTTPClient(nil) 应为 no-op")
	}
}
