package egressx

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func newLoopbackServer(t *testing.T, ip string, h http.Handler) *httptest.Server {
	t.Helper()
	l, err := net.Listen("tcp", ip+":0")
	if err != nil {
		t.Skipf("cannot bind %s (loopback /8 not fully routable here): %v", ip, err)
	}
	srv := &httptest.Server{
		Listener: l,
		Config:   &http.Server{Handler: h},
	}
	srv.Start()
	t.Cleanup(srv.Close)
	return srv
}

func redirectHandler(hits *atomic.Int32, next string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Location", next)
		w.WriteHeader(http.StatusFound)
	})
}

func TestHTTPClientRedirectChain_AllHopsAllowed(t *testing.T) {
	var hop3 atomic.Int32
	final := newLoopbackServer(t, "127.0.0.1", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hop3.Add(1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	var hop2 atomic.Int32
	mid := newLoopbackServer(t, "127.0.0.2", redirectHandler(&hop2, final.URL))

	var hop1 atomic.Int32
	first := newLoopbackServer(t, "127.0.0.1", redirectHandler(&hop1, mid.URL))

	c := mustClient(t, Opts{AllowCIDRs: []string{"127.0.0.0/8"}, DisableEnvProxy: true, Timeout: 10 * time.Second})
	resp, err := c.Get(first.URL)
	if err != nil {
		t.Fatalf("全放行多跳链应成功: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("final status = %d", resp.StatusCode)
	}
	if hop1.Load() != 1 || hop2.Load() != 1 || hop3.Load() != 1 {
		t.Fatalf("三跳各命中一次: hop1=%d hop2=%d hop3=%d", hop1.Load(), hop2.Load(), hop3.Load())
	}
}

func TestHTTPClientRedirectChain_PerHopEnforced(t *testing.T) {
	var hop2 atomic.Int32
	blocked := newLoopbackServer(t, "127.0.0.2", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hop2.Add(1)
		w.WriteHeader(http.StatusOK)
	}))

	var hop1 atomic.Int32
	first := newLoopbackServer(t, "127.0.0.1", redirectHandler(&hop1, blocked.URL))

	c := mustClient(t, Opts{AllowCIDRs: []string{"127.0.0.1/32"}, DisableEnvProxy: true, Timeout: 10 * time.Second})
	resp, err := c.Get(first.URL)
	if err == nil {
		t.Fatalf("重定向到未放行环回地址必须整体失败（got status %d）", resp.StatusCode)
	}
	if !containsEgress(err) {
		t.Fatalf("错误应来自 egress 防护层: %v", err)
	}
	if hop1.Load() != 1 {
		t.Fatalf("首跳（放行段内）应正常服务: %d", hop1.Load())
	}
	if hop2.Load() != 0 {
		t.Fatal("次跳在预检被拒，绝不得触达未放行服务")
	}
}

func TestHTTPClientRedirectChain_PrivateLiteralHop(t *testing.T) {
	private := "http://10.255.255.1/exfil"
	var hop1 atomic.Int32
	first := newLoopbackServer(t, "127.0.0.1", redirectHandler(&hop1, private))

	c := mustClient(t, Opts{AllowCIDRs: []string{"127.0.0.0/8"}, DisableEnvProxy: true, Timeout: 10 * time.Second})
	_, err := c.Get(first.URL)
	if err == nil {
		t.Fatal("重定向到未放行私网必须失败")
	}
	if !containsEgress(err) {
		t.Fatalf("错误应来自 egress 防护层而非拨号超时: %v", err)
	}
}

func containsEgress(err error) bool {
	for e := err; e != nil; e = unwrap(e) {
		if s := e.Error(); len(s) >= 6 && s[:6] == "egress" {
			return true
		}
	}
	return false
}

func unwrap(err error) error {
	u, ok := err.(interface{ Unwrap() error })
	if !ok {
		return nil
	}
	return u.Unwrap()
}

func TestNewHTTPClient_EnvProxyKnob(t *testing.T) {
	withEnv := mustClient(t, Opts{})
	gt, ok := withEnv.Transport.(*guardTransport)
	if !ok {
		t.Fatalf("expected *guardTransport, got %T", withEnv.Transport)
	}
	tr, ok := gt.base.(*http.Transport)
	if !ok {
		t.Fatalf("expected *http.Transport, got %T", gt.base)
	}
	if tr.Proxy == nil {
		t.Fatal("默认应沿用 http.ProxyFromEnvironment")
	}

	noEnv := mustClient(t, Opts{DisableEnvProxy: true})
	gt2 := noEnv.Transport.(*guardTransport)
	tr2 := gt2.base.(*http.Transport)
	if tr2.Proxy != nil {
		t.Fatal("DisableEnvProxy=true 必须关闭 env 代理（Proxy=nil）")
	}
}

func TestGuard_ResolverInjection(t *testing.T) {
	fake := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			return nil, fmt.Errorf("no dns in test")
		},
	}
	g, err := newGuard(nil, fake)
	if err != nil {
		t.Fatal(err)
	}
	if g.resolver != fake {
		t.Fatal("resolver 必须注入 Guard（预检与拨号同源解析）")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := g.ValidateURL(ctx, "https://host-that-would-never-resolve.invalid/"); err == nil {
		t.Fatal("注入 resolver 解析失败必须 fail-closed，不得回落真 DNS")
	}
}
