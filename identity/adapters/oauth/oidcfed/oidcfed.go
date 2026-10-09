package oidcfed

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/egressx"
)

const defaultScopes = "openid email profile"

const discoveryTTL = time.Hour

const EnvAllowPrivateIDP = "FED_ALLOW_PRIVATE_IDP"

func envAllowsPrivateIDP() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(EnvAllowPrivateIDP))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

type Resolver struct {
	mu    sync.Mutex
	cache map[string]cachedEndpoints
	hc    *http.Client
	now   func() time.Time
}

type cachedEndpoints struct {
	authorization, token, userinfo string
	expiresAt                      time.Time
}

func NewResolver() *Resolver {
	var allowCIDRs []string
	if envAllowsPrivateIDP() {
		allowCIDRs = egressx.PrivateAllowCIDRs()
	}
	hc, err := egressx.NewHTTPClient(egressx.Opts{Timeout: 10 * time.Second, AllowCIDRs: allowCIDRs})
	if err != nil {

		panic("oidcfed: egress client: " + err.Error())
	}
	return &Resolver{
		cache: map[string]cachedEndpoints{},
		hc:    hc,
		now:   time.Now,
	}
}

func (r *Resolver) WithHTTPClient(hc *http.Client) *Resolver {
	r.hc = hc
	return r
}

var _ app.FedResolver = (*Resolver)(nil)

func (r *Resolver) Resolve(ctx context.Context, issuerURL, clientID, clientSecret, scopes string) (app.FedOIDCProvider, error) {
	issuer := strings.TrimRight(issuerURL, "/")
	eps, err := r.endpoints(ctx, issuer)
	if err != nil {
		return nil, err
	}
	if scopes == "" {
		scopes = defaultScopes
	}
	return &Provider{
		clientID: clientID, clientSecret: clientSecret, scopes: scopes,
		authorizeEndpoint: eps.authorization, tokenEndpoint: eps.token, userinfoEndpoint: eps.userinfo,
		hc: r.hc,
	}, nil
}

func (r *Resolver) endpoints(ctx context.Context, issuer string) (cachedEndpoints, error) {
	r.mu.Lock()
	if eps, ok := r.cache[issuer]; ok && r.now().Before(eps.expiresAt) {
		r.mu.Unlock()
		return eps, nil
	}
	r.mu.Unlock()

	var doc struct {
		Issuer                string `json:"issuer"`
		AuthorizationEndpoint string `json:"authorization_endpoint"`
		TokenEndpoint         string `json:"token_endpoint"`
		UserinfoEndpoint      string `json:"userinfo_endpoint"`
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		issuer+"/.well-known/openid-configuration", nil)
	if err != nil {
		return cachedEndpoints{}, err
	}
	resp, err := r.hc.Do(req)
	if err != nil {
		return cachedEndpoints{}, fmt.Errorf("oidcfed: discovery %s: %w", issuer, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return cachedEndpoints{}, fmt.Errorf("oidcfed: discovery %s: http %d: %s", issuer, resp.StatusCode, body)
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return cachedEndpoints{}, fmt.Errorf("oidcfed: discovery %s: %w", issuer, err)
	}
	if doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" || doc.UserinfoEndpoint == "" {
		return cachedEndpoints{}, fmt.Errorf("oidcfed: discovery %s: missing endpoints (need authorization_endpoint/token_endpoint/userinfo_endpoint)", issuer)
	}

	if doc.Issuer != "" && doc.Issuer != issuer {
		return cachedEndpoints{}, fmt.Errorf("oidcfed: discovery %s: issuer mismatch: document claims %q", issuer, doc.Issuer)
	}

	eps := cachedEndpoints{
		authorization: doc.AuthorizationEndpoint,
		token:         doc.TokenEndpoint,
		userinfo:      doc.UserinfoEndpoint,
		expiresAt:     r.now().Add(discoveryTTL),
	}
	r.mu.Lock()
	r.cache[issuer] = eps
	r.mu.Unlock()
	return eps, nil
}

type Provider struct {
	clientID     string
	clientSecret string
	scopes       string

	authorizeEndpoint string
	tokenEndpoint     string
	userinfoEndpoint  string

	hc *http.Client
}

func (p *Provider) Name() string { return "oidc_fed" }

func (p *Provider) AuthURL(state, redirectURI, verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	return p.authorizeEndpoint + "?" +
		"response_type=code" +
		"&scope=" + url.QueryEscape(p.scopes) +
		"&client_id=" + url.QueryEscape(p.clientID) +
		"&redirect_uri=" + url.QueryEscape(redirectURI) +
		"&state=" + url.QueryEscape(state) +
		"&code_challenge=" + url.QueryEscape(challenge) +
		"&code_challenge_method=S256"
}

type tokenResp struct {
	AccessToken string `json:"access_token"`
}

type userinfoResp struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
}

func (p *Provider) Exchange(ctx context.Context, code, redirectURI, verifier string) (app.OAuthIdentity, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"client_id":     {p.clientID},
		"client_secret": {p.clientSecret},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenEndpoint,
		strings.NewReader(form.Encode()))
	if err != nil {
		return app.OAuthIdentity{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var tok tokenResp
	if err := p.doJSON(req, &tok); err != nil {
		return app.OAuthIdentity{}, fmt.Errorf("oidcfed: exchange token: %w", err)
	}
	if tok.AccessToken == "" {
		return app.OAuthIdentity{}, fmt.Errorf("oidcfed: empty access token")
	}

	var ui userinfoResp
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, p.userinfoEndpoint, nil)
	if err != nil {
		return app.OAuthIdentity{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	if err := p.doJSON(req, &ui); err != nil {
		return app.OAuthIdentity{}, fmt.Errorf("oidcfed: fetch userinfo: %w", err)
	}
	if ui.Sub == "" {
		return app.OAuthIdentity{}, fmt.Errorf("oidcfed: userinfo missing sub")
	}
	if ui.Email == "" {
		return app.OAuthIdentity{}, fmt.Errorf("oidcfed: userinfo missing email")
	}

	return app.OAuthIdentity{
		Provider:      p.Name(),
		Subject:       ui.Sub,
		Email:         ui.Email,
		Name:          ui.Name,
		EmailVerified: ui.EmailVerified,
	}, nil
}

func (p *Provider) doJSON(req *http.Request, dst any) error {
	resp, err := p.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("http %d: %s", resp.StatusCode, body)
	}
	return json.NewDecoder(resp.Body).Decode(dst)
}
