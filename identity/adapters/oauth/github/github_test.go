package github

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

func fakeGitHub(t *testing.T, h http.HandlerFunc) (tokenURL, apiBase string) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv.URL + "/login/oauth/access_token", srv.URL
}

func TestAuthURL(t *testing.T) {
	p := New("cid", "secret")
	got := p.AuthURL("abc123", "http://localhost:8030/auth/oauth/github/callback")
	want := "https://github.com/login/oauth/authorize" +
		"?client_id=cid" +
		"&redirect_uri=" + url.QueryEscape("http://localhost:8030/auth/oauth/github/callback") +
		"&state=abc123" +
		"&scope=read:user%20user:email"
	assert.Equal(t, want, got)
}

func TestExchange_HappyPath(t *testing.T) {
	var gotTokenAuth string
	tokenURL, apiBase := fakeGitHub(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/login/oauth/access_token":

			assert.Equal(t, http.MethodPost, r.Method)
			assert.Equal(t, "application/json", r.Header.Get("Accept"))
			require.NoError(t, r.ParseForm())
			assert.Equal(t, "cid", r.PostFormValue("client_id"))
			assert.Equal(t, "secret", r.PostFormValue("client_secret"))
			assert.Equal(t, "the-code", r.PostFormValue("code"))
			assert.Equal(t, "http://localhost:8030/auth/oauth/github/callback", r.PostFormValue("redirect_uri"))
			_, _ = w.Write([]byte(`{"access_token":"gho_tok","token_type":"bearer"}`))
		case "/user":
			gotTokenAuth = r.Header.Get("Authorization")
			_, _ = w.Write([]byte(`{"id":42,"login":"octocat","name":"Octo Cat","email":null}`))
		case "/user/emails":
			_, _ = w.Write([]byte(`[
				{"email":"secondary@example.com","primary":false,"verified":true},
				{"email":"octo@example.com","primary":true,"verified":true}]`))
		default:
			http.NotFound(w, r)
		}
	})

	p := New("cid", "secret")
	p.setBaseURLs("https://github.com/login/oauth/authorize", tokenURL, apiBase)

	id, err := p.Exchange(context.Background(), "the-code", "http://localhost:8030/auth/oauth/github/callback")
	require.NoError(t, err)
	assert.Equal(t, "Bearer gho_tok", gotTokenAuth, "user 端点必须带 Bearer token")
	assert.Equal(t, "github", id.Provider)
	assert.Equal(t, "42", id.Subject, "GitHub subject 是数字 id 的十进制字符串")
	assert.Equal(t, "octo@example.com", id.Email, "取 verified primary 邮箱")
	assert.Equal(t, "Octo Cat", id.Name)
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
			_, _ = w.Write([]byte(`{"error":"bad_verification_code"}`))
		}},
		{"user 端点 401（token 失效）", func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/login/oauth/access_token":
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"access_token":"gho_tok"}`))
			default:
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			}
		}},
		{"emails 无 verified primary", func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/login/oauth/access_token":
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"access_token":"gho_tok"}`))
			case "/user":
				_, _ = w.Write([]byte(`{"id":42,"login":"octocat","name":"Octo Cat"}`))
			case "/user/emails":
				_, _ = w.Write([]byte(`[{"email":"octo@example.com","primary":true,"verified":false}]`))
			default:
				http.NotFound(w, r)
			}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tokenURL, apiBase := fakeGitHub(t, tt.handler)
			p := New("cid", "secret")
			p.setBaseURLs("https://github.com/login/oauth/authorize", tokenURL, apiBase)
			id, err := p.Exchange(context.Background(), "code", "http://localhost:8030/cb")
			require.Error(t, err)
			assert.Equal(t, "github", p.Name())
			assert.Empty(t, id.Email)
		})
	}
}

type recordingTransport struct {
	hits int
	err  error
}

func (rt *recordingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	rt.hits++
	return nil, rt.err
}

func TestWithHTTPClient_EG5(t *testing.T) {
	p := New("cid", "secret")
	if p.hc.Timeout != 10*time.Second {
		t.Fatalf("默认 client 应自带 10s 超时, got %v", p.hc.Timeout)
	}

	rt := &recordingTransport{err: errors.New("egress-injected-sentinel")}
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
