package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/haozing/ploykit/identity/app"
)

const (
	defaultAuthorizeURL = "https://github.com/login/oauth/authorize"
	defaultTokenURL     = "https://github.com/login/oauth/access_token"
	defaultAPIBase      = "https://api.github.com"

	scope = "read:user%20user:email"
)

type Provider struct {
	clientID     string
	clientSecret string
	authorizeURL string
	tokenURL     string
	apiBase      string
	hc           *http.Client
}

func New(clientID, clientSecret string) *Provider {
	return &Provider{
		clientID:     clientID,
		clientSecret: clientSecret,
		authorizeURL: defaultAuthorizeURL,
		tokenURL:     defaultTokenURL,
		apiBase:      defaultAPIBase,
		hc:           &http.Client{Timeout: 10 * time.Second},
	}
}

func (p *Provider) setBaseURLs(authorize, token, api string) {
	p.authorizeURL, p.tokenURL, p.apiBase = authorize, token, api
}

func (p *Provider) WithHTTPClient(hc *http.Client) *Provider {
	if hc != nil {
		p.hc = hc
	}
	return p
}

func (p *Provider) Name() string { return "github" }

func (p *Provider) AuthURL(state, redirectURI string) string {
	return p.authorizeURL + "?" +
		"client_id=" + url.QueryEscape(p.clientID) +
		"&redirect_uri=" + url.QueryEscape(redirectURI) +
		"&state=" + url.QueryEscape(state) +
		"&scope=" + scope
}

type tokenResp struct {
	AccessToken string `json:"access_token"`
}

type userResp struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Name  string `json:"name"`
}

type emailResp struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

func (p *Provider) Exchange(ctx context.Context, code, redirectURI string) (app.OAuthIdentity, error) {

	form := url.Values{
		"client_id":     {p.clientID},
		"client_secret": {p.clientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return app.OAuthIdentity{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var tok tokenResp
	if err := p.doJSON(req, &tok); err != nil {
		return app.OAuthIdentity{}, fmt.Errorf("github: exchange token: %w", err)
	}
	if tok.AccessToken == "" {
		return app.OAuthIdentity{}, fmt.Errorf("github: empty access token")
	}

	var u userResp
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, p.apiBase+"/user", nil)
	if err != nil {
		return app.OAuthIdentity{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	if err := p.doJSON(req, &u); err != nil {
		return app.OAuthIdentity{}, fmt.Errorf("github: fetch user: %w", err)
	}
	if u.ID == 0 {
		return app.OAuthIdentity{}, fmt.Errorf("github: user id missing")
	}

	var emails []emailResp
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, p.apiBase+"/user/emails", nil)
	if err != nil {
		return app.OAuthIdentity{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	if err := p.doJSON(req, &emails); err != nil {
		return app.OAuthIdentity{}, fmt.Errorf("github: fetch emails: %w", err)
	}
	primary := ""
	for _, e := range emails {
		if e.Primary && e.Verified {
			primary = e.Email
			break
		}
	}
	if primary == "" {
		return app.OAuthIdentity{}, fmt.Errorf("github: no verified primary email")
	}

	name := u.Name
	if name == "" {
		name = u.Login
	}
	return app.OAuthIdentity{
		Provider:      p.Name(),
		Subject:       strconv.FormatInt(u.ID, 10),
		Email:         primary,
		Name:          name,
		EmailVerified: true,
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
