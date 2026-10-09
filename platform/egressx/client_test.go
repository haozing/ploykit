package egressx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func mustGuard(cidrs ...string) *Guard {
	g, err := NewGuard(cidrs)
	if err != nil {
		panic(err)
	}
	return g
}

func mustClient(t *testing.T, opts Opts) *http.Client {
	t.Helper()
	c, err := NewHTTPClient(opts)
	if err != nil {
		t.Fatalf("NewHTTPClient: %v", err)
	}
	return c
}

func TestCheckDialAddress(t *testing.T) {
	strict := mustGuard()
	allowPrivate := mustGuard("127.0.0.0/8", "10.0.0.0/8")

	cases := []struct {
		name    string
		guard   *Guard
		address string
		wantErr bool
	}{
		{"环回拒绝(严格)", strict, "127.0.0.1:443", true},
		{"环回全段拒绝(严格)", strict, "127.8.8.8:80", true},
		{"私网 A 类拒绝(严格)", strict, "10.1.2.3:80", true},
		{"私网 B 类拒绝(严格)", strict, "172.16.0.9:443", true},
		{"私网 C 类拒绝(严格)", strict, "192.168.1.20:8080", true},
		{"link-local/云元数据拒绝(严格)", strict, "169.254.169.254:80", true},
		{"未指定地址拒绝(严格)", strict, "0.0.0.0:80", true},
		{"IPv6 环回拒绝(严格)", strict, "[::1]:443", true},
		{"IPv6 ULA 拒绝(严格)", strict, "[fc00::1]:80", true},
		{"IPv6 link-local 拒绝(严格)", strict, "[fe80::1]:80", true},
		{"公网 IPv4 放行(严格)", strict, "8.8.8.8:443", false},
		{"公网 IPv4 放行二(严格)", strict, "1.1.1.1:80", false},
		{"公网 IPv6 放行(严格)", strict, "[2606:4700:4700::1111]:443", false},
		{"环回放行(allowlist 命中)", allowPrivate, "127.0.0.1:9999", false},
		{"10/8 放行(allowlist 命中)", allowPrivate, "10.1.2.3:80", false},
		{"allowlist 外的私网仍拒绝", allowPrivate, "192.168.1.20:80", true},
		{"allowlist 外的 link-local 仍拒绝", allowPrivate, "169.254.169.254:80", true},
		{"公网不受 allowlist 影响", allowPrivate, "8.8.8.8:443", false},
		{"非 IP 字面量 fail-closed", strict, "example.com:443", true},
		{"残缺地址 fail-closed", strict, "127001", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.guard.checkDialAddress(c.address)
			if c.wantErr && err == nil {
				t.Errorf("checkDialAddress(%q) 应拒绝", c.address)
			}
			if !c.wantErr && err != nil {
				t.Errorf("checkDialAddress(%q) 应放行: %v", c.address, err)
			}
		})
	}
}

func TestCheckDialAddress_NameAgnostic(t *testing.T) {
	g := mustGuard()

	if err := g.checkDialAddress("10.0.0.9:443"); err == nil {
		t.Fatal("连接时实际 IP 落私网必须拒绝，与预检时的域名解析结果无关")
	}
}

func TestNewHTTPClient_InvalidCIDRFails(t *testing.T) {
	if _, err := NewHTTPClient(Opts{AllowCIDRs: []string{"not-a-cidr"}}); err == nil {
		t.Fatal("非法 CIDR 应在构造期报错")
	}
}

func TestNewHTTPClient_DefaultTimeout(t *testing.T) {
	c := mustClient(t, Opts{})
	if c.Timeout != defaultHTTPTimeout {
		t.Fatalf("默认超时 = %v, want %v", c.Timeout, defaultHTTPTimeout)
	}
	c2 := mustClient(t, Opts{Timeout: 3 * time.Second})
	if c2.Timeout != 3*time.Second {
		t.Fatalf("显式超时应生效, got %v", c2.Timeout)
	}
}

func TestGuardOf(t *testing.T) {
	c := mustClient(t, Opts{})
	if GuardOf(c) == nil {
		t.Fatal("NewHTTPClient 构造的 client 应能取回 Guard")
	}
	if GuardOf(&http.Client{}) != nil {
		t.Fatal("普通 client 应返回 nil")
	}
	if GuardOf(nil) != nil {
		t.Fatal("nil client 应返回 nil")
	}
}

func TestGuardTransport_PrecheckBlocksBeforeDial(t *testing.T) {
	var baseHit bool
	base := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		baseHit = true
		return nil, nil
	})
	gt := &guardTransport{base: base, guard: mustGuard()}

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://10.0.0.5/hook", nil)
	if _, err := gt.RoundTrip(req); err == nil {
		t.Fatal("私网目标应在预检被拒")
	}
	if baseHit {
		t.Fatal("预检拒绝不应触达底层 Transport")
	}

	req2, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://8.8.8.8/x", nil)
	if _, err := gt.RoundTrip(req2); err != nil {
		t.Fatalf("https 公网字面量应通过预检: %v", err)
	}
	if !baseHit {
		t.Fatal("放行请求应触达底层 Transport")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestHTTPClientEndToEnd_Loopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	strict := mustClient(t, Opts{})
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, srv.URL, nil)
	_, err := strict.Do(req)
	if err == nil {
		t.Fatal("严格 client 对环回目标应整体失败")
	}
	if !strings.Contains(err.Error(), "egress") {
		t.Logf("拒绝错误（可能来自预检或 Control）: %v", err)
	}

	allowed := mustClient(t, Opts{AllowCIDRs: []string{"127.0.0.0/8"}})
	req2, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, srv.URL, nil)
	resp, err := allowed.Do(req2)
	if err != nil {
		t.Fatalf("放行环回段后应投递成功: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}
