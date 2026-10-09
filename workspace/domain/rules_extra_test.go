package domain

import (
	"testing"
	"time"
)

func TestCanLeave_UTWD04(t *testing.T) {
	cases := []struct {
		role        string
		isLastOwner bool
		want        bool
	}{
		{RoleOwner, true, false},
		{RoleOwner, false, true},
		{RoleAdmin, true, true},
		{RoleMember, true, true},
		{RoleMember, false, true},
	}
	for _, c := range cases {
		if got := CanLeave(c.role, c.isLastOwner); got != c.want {
			t.Errorf("CanLeave(%q,%v)=%v want %v", c.role, c.isLastOwner, got, c.want)
		}
	}
}

func TestInviteExpiry_UTWD05(t *testing.T) {
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	got := InviteExpiry(now)
	if !got.Equal(now.Add(7 * 24 * time.Hour)) {
		t.Errorf("InviteExpiry=%v want %v", got, now.Add(7*24*time.Hour))
	}
	if InviteTTL != 7*24*time.Hour {
		t.Errorf("InviteTTL=%v want 7d", InviteTTL)
	}
}

func TestShareCodeRules_UTWD06(t *testing.T) {
	code, err := MintShareCode()
	if err != nil {
		t.Fatalf("MintShareCode: %v", err)
	}
	if len(code) != ShareCodeLen {
		t.Errorf("code len=%d want %d", len(code), ShareCodeLen)
	}
	if !ShareCodeOK(code) {
		t.Errorf("合法码应通过: %q", code)
	}

	for _, bad := range []string{"", "abc", code[:23], code + "0", "Z" + code[1:]} {
		if ShareCodeOK(bad) {
			t.Errorf("ShareCodeOK(%q) 应为 false", bad)
		}
	}

	h1, h2 := HashShareCode(code), HashShareCode(code)
	if h1 != h2 || len(h1) != 64 {
		t.Errorf("HashShareCode 应确定性输出 64 hex, got %q/%q", h1, h2)
	}
	if h1 == HashShareCode(code+"x") {
		t.Error("不同码不应同哈希")
	}
}

func TestSlugRules_UTWD07(t *testing.T) {

	if SlugOK("abc") {
		t.Error("3 字符 slug 应非法")
	}
	if !SlugOK("abcd") {
		t.Error("4 字符 slug 应合法")
	}
	if !SlugOK("a" + repeat("b", 38) + "c") {
		t.Error("40 字符 slug 应合法")
	}
	if SlugOK("a" + repeat("b", 39) + "c") {
		t.Error("41 字符 slug 应非法")
	}
	if SlugOK("-abc") || SlugOK("abc-") || SlugOK("ab_c") || SlugOK("Abc") {
		t.Error("首尾'-'、下划线、大写应非法")
	}

	if !SlugReserved("API") || !SlugReserved("Admin") || !SlugReserved("billing") {
		t.Error("保留字判定应大小写不敏感")
	}
	if SlugReserved("my-workspace") {
		t.Error("非保留字不应命中")
	}
}

func repeat(s string, n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += s
	}
	return out
}

func TestEmailRules_UTWD08(t *testing.T) {
	cases := []struct {
		email string
		want  bool
	}{
		{"a@b.co", true},
		{"", false},
		{"no-at-sign", false},
		{"a@b", false},
		{"a@@b.co", false},
		{"a b@c.co", false},
		{"a@b.c", true},
	}
	for _, c := range cases {
		if got := EmailOK(c.email); got != c.want {
			t.Errorf("EmailOK(%q)=%v want %v", c.email, got, c.want)
		}
	}

	local := make([]byte, 249)
	for i := range local {
		local[i] = 'a'
	}
	long254 := string(local) + "@example.com"
	long254 = padEmail(254)
	long255 := padEmail(255)
	if !EmailOK(long254) {
		t.Error("254 长度邮箱应合法")
	}
	if EmailOK(long255) {
		t.Error("255 长度邮箱应非法")
	}

	if got := NormalizeEmail("  A@Example.COM "); got != "a@example.com" {
		t.Errorf("NormalizeEmail=%q want a@example.com", got)
	}
	_ = long254
}

func padEmail(n int) string {
	suffix := "@e.co"
	local := n - len(suffix)
	if local < 1 {
		return ""
	}
	b := make([]byte, local)
	for i := range b {
		b[i] = 'a'
	}
	return string(b) + suffix
}
