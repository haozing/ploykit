package waffo

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client 是带请求签名的 waffo REST/GraphQL 客户端。签名算法
// (docs/api-reference/authentication):
//
//	canonical = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + B64(SHA256(body))
//	X-Signature = B64(RSA-SHA256(canonical, privateKey))
//
// TIMESTAMP 为 Unix 秒,服务端容忍 -5min/+1min;本机时钟漂移过大时 waffo 回 401,
// 那是机器时钟问题不是密钥问题。
type Client struct {
	MerchantID string
	BaseURL    string
	HTTP       *http.Client

	key *rsa.PrivateKey
	now func() time.Time // 测试注入;生产 = time.Now
}

// apiEnvelope waffo 成功响应的统一包裹 {"data": {...}}(GraphQL 响应同形)。
// GraphQL 语义:HTTP 200 也可能带顶层 errors 数组(部分错误/全错误),
// 只看状态码会把探活做成假阳性。
type apiEnvelope struct {
	Data   json.RawMessage   `json:"data"`
	Errors []apiGraphQLError `json:"errors"`
}

// apiGraphQLError GraphQL 顶层 errors 数组元素;只取 message(本包唯一
// 的 GraphQL 调用是探活,错误码/路径不需要)。
type apiGraphQLError struct {
	Message string `json:"message"`
}

// apiError 非 2xx 响应;4xx 不重试(waffo 文档明确),5xx 由调用方决定
// 是否把订单置失败让用户重发起。
type apiError struct {
	Status  int
	Method  string
	Path    string
	Snippet string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("waffo: %s %s: status %d: %s", e.Method, e.Path, e.Status, e.Snippet)
}

// do 签名、发送、解码。path 必须以 / 开头(签名输入的 PATH 与实际请求
// path 完全一致,含 query 时两边都要带 —— 本包只用无 query 的 POST)。
func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			return fmt.Errorf("waffo: encode request: %w", err)
		}
	} else {
		raw = []byte("{}")
	}

	nowFn := c.now
	if nowFn == nil {
		nowFn = time.Now
	}
	ts := nowFn().Unix()
	bodyHash := sha256.Sum256(raw)
	canonical := method + "\n" + path + "\n" + fmt.Sprint(ts) + "\n" + base64.StdEncoding.EncodeToString(bodyHash[:])
	canonicalHash := sha256.Sum256([]byte(canonical))
	sig, err := c.key.Sign(rand.Reader, canonicalHash[:], crypto.SHA256)
	if err != nil {
		return fmt.Errorf("waffo: sign request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("waffo: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Merchant-Id", c.MerchantID)
	req.Header.Set("X-Timestamp", fmt.Sprint(ts))
	req.Header.Set("X-Signature", base64.StdEncoding.EncodeToString(sig))

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("waffo: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("waffo: %s %s: read response: %w", method, path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &apiError{Status: resp.StatusCode, Method: method, Path: path, Snippet: snippet(respBody)}
	}
	if out == nil {
		return nil
	}
	var env apiEnvelope
	if err := json.Unmarshal(respBody, &env); err != nil {
		return fmt.Errorf("waffo: %s %s: decode envelope: %w", method, path, err)
	}
	// GraphQL 规范允许 200 + errors(REST 网关不会发顶层 errors,这条
	// 实际只影响 graphql 探活):非空 errors 即失败,带首条 message ——
	// 否则 TestConnection 对凭据失效等错误假阳性放行。
	if len(env.Errors) > 0 {
		first := env.Errors[0].Message
		if first == "" {
			first = "(empty message)"
		}
		return fmt.Errorf("waffo: %s %s: graphql error: %s", method, path, first)
	}
	if len(env.Data) == 0 {
		return nil
	}
	if err := json.Unmarshal(env.Data, out); err != nil {
		return fmt.Errorf("waffo: %s %s: decode data: %w", method, path, err)
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
