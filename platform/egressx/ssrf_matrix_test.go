package egressx

import (
	"context"
	"net/netip"
	"sort"
	"strings"
	"testing"
)

func TestBlockedRangesMatrix_EG2(t *testing.T) {
	strict := DefaultGuard()

	cases := []struct {
		name string
		in   string
		out  string
	}{

		{"CGNAT 100.64/10 首段（Tailscale 默认段）", "100.64.0.1:443", "100.128.0.1:443"},
		{"CGNAT 100.64/10 末段", "100.127.255.255:443", "100.128.0.1:443"},
		{"IETF 协议指派 192.0.0/24", "192.0.0.9:443", "192.0.1.1:443"},
		{"文档段 TEST-NET-1 192.0.2/24", "192.0.2.1:443", "192.0.3.1:443"},
		{"基准段 198.18/15 首地址", "198.18.0.1:443", "198.20.0.1:443"},
		{"基准段 198.18/15 末地址", "198.19.255.254:443", "198.20.0.1:443"},
		{"文档段 TEST-NET-2 198.51.100/24", "198.51.100.5:443", "198.51.101.5:443"},
		{"文档段 TEST-NET-3 203.0.113/24", "203.0.113.7:443", "203.0.114.1:443"},
		{"组播 224/4 首段", "224.0.0.1:443", "223.255.255.254:443"},
		{"组播 224/4 之 SSDP 239.255.255.250（探 UPnP 经典向量）", "239.255.255.250:1900", "223.255.255.254:443"},
		{"保留 240/4（原 E 类）", "240.0.0.1:443", "223.255.255.254:443"},
		{"广播 255.255.255.255", "255.255.255.255:443", "223.255.255.254:443"},

		{"未指定 ::/128", "[::]:443", "[2606:4700:4700::1111]:443"},
		{"NAT64 本地段 64:ff9b:1::/48（RFC 8215 整段拒）", "[64:ff9b:1::1]:443", "[64:ff9b:2::1]:443"},
		{"discard-only 100::/64（RFC 6666）", "[100::1]:443", "[100:0:0:2::1]:443"},
		{"dummy 前缀 100:0:0:1::/64（RFC 9780）", "[100:0:0:1::1]:443", "[100:0:0:2::1]:443"},
		{"Teredo 2001::/32", "[2001::1]:443", "[2001:1::1]:443"},
		{"基准 2001:2::/48（RFC 5180）", "[2001:2::1]:443", "[2001:3::1]:443"},
		{"弃用 ORCHID 2001:10::/28", "[2001:10::1]:443", "[2001:40::1]:443"},
		{"ORCHIDv2 2001:20::/28", "[2001:20::1]:443", "[2001:40::1]:443"},
		{"文档段 2001:db8::/32", "[2001:db8::1]:443", "[2001:db9::1]:443"},
		{"6to4 2002::/16（内嵌 192.0.2.2）", "[2002:c000:202::1]:443", "[2003::1]:443"},
		{"文档段 3fff::/20（RFC 9637）", "[3fff::1]:443", "[4000::1]:443"},
		{"SRv6 5f00::/16（RFC 9602）", "[5f00::1]:443", "[5f01::1]:443"},
		{"组播 ff00::/8", "[ff02::1]:443", "[2606:4700:4700::1111]:443"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := strict.checkDialAddress(c.in); err == nil {
				t.Errorf("checkDialAddress(%q) 段内地址应拒绝", c.in)
			}
			if err := strict.checkDialAddress(c.out); err != nil {
				t.Errorf("checkDialAddress(%q) 段外邻址应放行, got %v", c.out, err)
			}
		})
	}
}

func TestEmbeddedIPv4Variants_EG2(t *testing.T) {
	strict := DefaultGuard()
	allowTen := mustGuard("10.0.0.0/8")

	rejected := []string{
		"::ffff:a00:1",
		"::ffff:7f00:1",
		"::a00:1",
		"::ffff:0:a00:1",
		"64:ff9b::a00:1",
		"64:ff9b::7f00:1",
		"64:ff9b::c000:202",
		"64:ff9b::a9fe:a9fe",
	}
	for _, s := range rejected {
		if err := strict.checkIP(mustAddr(t, s), "variant-test"); err == nil {
			t.Errorf("checkIP(%s) 内嵌私网/环回变体应拒绝", s)
		}
	}

	allowed := []string{
		"::ffff:808:808",
		"::808:808",
		"::ffff:0:808:808",
		"64:ff9b::808:808",
	}
	for _, s := range allowed {
		if err := strict.checkIP(mustAddr(t, s), "variant-test"); err != nil {
			t.Errorf("checkIP(%s) 公网载荷变体应放行, got %v", s, err)
		}
	}

	if err := allowTen.checkIP(mustAddr(t, "64:ff9b::a00:1"), "nat64-allow"); err != nil {
		t.Errorf("放行 10/8 时 NAT64 内嵌 10.x 应放行（allowlist 优先于解码后的拒绝段）, got %v", err)
	}

	for _, raw := range []string{
		"https://[64:ff9b::7f00:1]/x",
		"https://[::ffff:a00:1]/x",
		"https://[::a00:1]/x",
		"https://[::ffff:0:a00:1]/x",
		"https://[64:ff9b:1::1]/x",
		"https://[2002:c000:202::1]/x",
	} {
		if err := strict.ValidateURL(context.Background(), raw); err == nil {
			t.Errorf("ValidateURL(%q) 内嵌私网变体应拒绝", raw)
		}
	}
	for _, addr := range []string{
		"[64:ff9b::7f00:1]:443",
		"[::ffff:a00:1]:443",
		"[::a00:1]:443",
		"[::ffff:0:a00:1]:443",
	} {
		if err := strict.checkDialAddress(addr); err == nil {
			t.Errorf("checkDialAddress(%q) 内嵌私网变体应拒绝", addr)
		}
	}

	if err := strict.ValidateURL(context.Background(), "https://[64:ff9b::808:808]/x"); err != nil {
		t.Errorf("NAT64 公网载荷应放行, got %v", err)
	}
}

func TestValidateURL_UnresolvableFailClosed_EG3(t *testing.T) {
	g := DefaultGuard()
	ctx := context.Background()

	err := g.ValidateURL(ctx, "https://ploykit-eg3-regression.invalid/hook")
	if err == nil {
		t.Fatal("https 分支解析失败必须报错（fail-closed），不得放行")
	}
	if !strings.Contains(err.Error(), "resolved") {
		t.Errorf("https 分支错误文案应区分'解析失败'语义, got %q", err.Error())
	}

	err = g.ValidateURL(ctx, "http://ploykit-eg3-regression.invalid/hook")
	if err == nil {
		t.Fatal("http 分支解析失败必须报错（fail-closed，既有行为回归锚定）")
	}
	if !strings.Contains(err.Error(), "resolved") {
		t.Errorf("http 分支错误文案应区分'解析失败'语义, got %q", err.Error())
	}
}

func TestPrivateAllowCIDRs_Mirror_EG2(t *testing.T) {
	blocked := BlockedCIDRs()
	allow := PrivateAllowCIDRs()
	if len(blocked) < 30 {
		t.Fatalf("内建拒绝段应扩容到 ssrf_filter 全集（≥30 段，v4 15 + v6 15+），got %d", len(blocked))
	}
	if len(allow) != len(blocked) {
		t.Fatalf("放行清单应与拒绝段一一同源镜像: allow=%d blocked=%d", len(allow), len(blocked))
	}
	sort.Strings(blocked)
	sort.Strings(allow)
	for i := range blocked {
		if blocked[i] != allow[i] {
			t.Fatalf("镜像失同步: blocked[%d]=%s allow[%d]=%s", i, blocked[i], i, allow[i])
		}
		if _, err := netip.ParsePrefix(blocked[i]); err != nil {
			t.Errorf("导出 CIDR %q 不可解析: %v", blocked[i], err)
		}
	}

	allow[0] = "0.0.0.0/0"
	if PrivateAllowCIDRs()[0] == "0.0.0.0/0" {
		t.Fatal("导出函数必须返回拷贝，禁止向外暴露可变共享切片")
	}

	dev, err := NewGuard(PrivateAllowCIDRs())
	if err != nil {
		t.Fatalf("NewGuard(PrivateAllowCIDRs()): %v", err)
	}
	for _, addr := range []string{
		"100.64.0.1:443", "224.0.0.1:443", "203.0.113.7:443",
		"[64:ff9b:1::1]:443", "[2001:db8::1]:443", "[ff02::1]:443",
	} {
		if err := dev.checkDialAddress(addr); err != nil {
			t.Errorf("dev 放行面应覆盖 %s, got %v", addr, err)
		}
	}
	if err := dev.checkIP(mustAddr(t, "64:ff9b::a00:1"), "dev-nat64"); err != nil {
		t.Errorf("dev 放行面下 NAT64 内嵌私网应经解码命中 allowlist, got %v", err)
	}

	if err := dev.ValidateURL(context.Background(), "ftp://10.0.0.1/hook"); err == nil {
		t.Error("dev 放行面不得豁免 scheme 白名单")
	}
	if err := dev.ValidateURL(context.Background(), "http://8.8.8.8/hook"); err == nil {
		t.Error("dev 放行面不得放行公网明文 http")
	}
}
