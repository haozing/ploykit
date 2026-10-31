package googleoidc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/haozing/ploykit/identity/app"
)

const (
	defaultAuthorizeURL = "https://accounts.google.com/o/oauth2/v2/auth"
	defaultTokenURL     = "https://oauth2.googleapis.com/token"
	defaultAPIBase      = "https://openidconnect.googleapis.com"

	// scope 是明文值（OA-8）：旧实现手工预编码 "openid%20email%20profile"
	// 直接拼 URL，与其余参数走 QueryEscape 的风格不一致——谁顺手再包一层
	// 就双重编码。现在统一走 url.Values.Encode()（空格编码为 +，
	// application/x-www-form-urlencoded 合法，Google 两种都收）。
	scope = "openid email profile"
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

func (p *Provider) Name() string { return "google" }

func (p *Provider) AuthURL(state, redirectURI string) string {
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("scope", scope)
	q.Set("client_id", p.clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	return p.authorizeURL + "?" + q.Encode()
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

func (p *Provider) Exchange(ctx context.Context, code, redirectURI string) (app.OAuthIdentity, error) {

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {p.clientID},
		"client_secret": {p.clientSecret},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return app.OAuthIdentity{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var tok tokenResp
	if err := p.doJSON(req, &tok); err != nil {
		return app.OAuthIdentity{}, fmt.Errorf("googleoidc: exchange token: %w", err)
	}
	if tok.AccessToken == "" {
		return app.OAuthIdentity{}, fmt.Errorf("googleoidc: empty access token")
	}

	var ui userinfoResp
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, p.apiBase+"/v1/userinfo", nil)
	if err != nil {
		return app.OAuthIdentity{}, err
	}
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	if err := p.doJSON(req, &ui); err != nil {
		return app.OAuthIdentity{}, fmt.Errorf("googleoidc: fetch userinfo: %w", err)
	}
	if ui.Sub == "" {
		return app.OAuthIdentity{}, fmt.Errorf("googleoidc: userinfo missing sub")
	}
	if ui.Email == "" {
		return app.OAuthIdentity{}, fmt.Errorf("googleoidc: userinfo missing email")
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
