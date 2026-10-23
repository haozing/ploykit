package paypal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// tokenRefreshMargin 是 token 缓存的安全边距:过期前 60s 即重取
// (https://developer.paypal.com/api/rest/authentication/:expires_in 秒数
// 只是参考,提前刷新避免请求带着将死 token 出网)。
const tokenRefreshMargin = 60 * time.Second

// tokenMinTTL 兜底 expires_in 缺失/过小:至少把缓存期压到半分钟,
// 不让 0/负值把"已过期"判成"永不过期"。
const tokenMinTTL = 30 * time.Second

// Client 是带 OAuth2 token 缓存的 PayPal REST 客户端
// (https://developer.paypal.com/api/rest/):
//
//	POST /v1/oauth2/token
//	  Authorization: Basic base64(client_id:client_secret)
//	  Content-Type: application/x-www-form-urlencoded
//	  body: grant_type=client_credentials
//	  → {"access_token":"...","token_type":"Bearer","expires_in":32400,...}
//
// 之后每个 API 请求带 Authorization: Bearer <token>。token 进程内缓存
// (锁保护,并发取一次),到期前 margin 即刷新。
type Client struct {
	ClientID     string
	ClientSecret string
	BaseURL      string
	HTTP         *http.Client

	now func() time.Time // 测试注入;生产 = time.Now

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time // 缓存 token 的绝对过期点(已扣掉 margin)
}

// apiError 非 2xx 响应;PayPal 错误体形如
// {"name":"INVALID_REQUEST","message":"...","details":[...]},
// 原样截断进 Snippet,调用方按需展开。
type apiError struct {
	Status  int
	Method  string
	Path    string
	Snippet string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("paypal: %s %s: status %d: %s", e.Method, e.Path, e.Status, e.Snippet)
}

// oauthTokenResp /v1/oauth2/token 响应(只取用到的字段)。
type oauthTokenResp struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
}

// token 返回缓存的 access token,过期(或 margin 内将过期)则重取。
// TestConnection 也走这里 —— 取到 token 即凭据+网络全通(最便宜的无副作用探活)。
func (c *Client) token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	nowFn := c.now
	if nowFn == nil {
		nowFn = time.Now
	}
	now := nowFn()
	if c.accessToken != "" && now.Before(c.tokenExpiry) {
		return c.accessToken, nil
	}

	form := url.Values{"grant_type": {"client_credentials"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/v1/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("paypal: build oauth request: %w", err)
	}
	req.SetBasicAuth(c.ClientID, c.ClientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("paypal: oauth token: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("paypal: oauth token: read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", &apiError{Status: resp.StatusCode, Method: http.MethodPost, Path: "/v1/oauth2/token", Snippet: snippet(body)}
	}
	var tok oauthTokenResp
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", fmt.Errorf("paypal: oauth token: decode: %w", err)
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("paypal: oauth token: empty access_token")
	}
	ttl := time.Duration(tok.ExpiresIn)*time.Second - tokenRefreshMargin
	if ttl < tokenMinTTL {
		ttl = tokenMinTTL
	}
	c.accessToken = tok.AccessToken
	c.tokenExpiry = now.Add(ttl)
	return c.accessToken, nil
}

// do 取 token、发送、解码。path 必须以 / 开头;body 为 nil 时发空 JSON 体。
// PayPal 成功响应没有统一包裹(区别于 waffo 的 {"data":...}),直接把 body
// 解进 out;out 为 nil 时只看状态码(update-pricing-schemes/cancel 都是 204)。
func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	tok, err := c.token(ctx)
	if err != nil {
		return err
	}
	var raw []byte
	if body != nil {
		if raw, err = json.Marshal(body); err != nil {
			return fmt.Errorf("paypal: encode request: %w", err)
		}
	} else {
		raw = []byte("{}")
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("paypal: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("paypal: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("paypal: %s %s: read response: %w", method, path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &apiError{Status: resp.StatusCode, Method: method, Path: path, Snippet: snippet(respBody)}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("paypal: %s %s: decode response: %w", method, path, err)
	}
	return nil
}

func snippet(b []byte) string {
	const max = 256
	if len(b) > max {
		b = b[:max]
	}
	return string(b)
}
