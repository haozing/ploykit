package domain

import (
	"strings"
	"testing"
	"time"
)

func TestCodeExpiry_UTID05(t *testing.T) {
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	if got := CodeExpiry(now); !got.Equal(now.Add(CodeTTL)) {
		t.Errorf("CodeExpiry=%v want %v", got, now.Add(CodeTTL))
	}
	if CodeTTL != 10*time.Minute {
		t.Errorf("CodeTTL=%v want 10m", CodeTTL)
	}
}

func TestMintLinkToken_UTID06(t *testing.T) {
	a, err := MintLinkToken()
	if err != nil {
		t.Fatalf("MintLinkToken: %v", err)
	}
	b, _ := MintLinkToken()
	if len(a) != 64 {
		t.Errorf("token len=%d want 64 (32 bytes hex)", len(a))
	}
	if a == b {
		t.Error("两次生成不应相同")
	}
}

func TestEmailRules_UTID07(t *testing.T) {
	cases := []struct {
		email string
		want  bool
	}{
		{"user@example.com", true},
		{"", false},
		{"no-at", false},
		{"a@b", false},
		{"a@b.c", true},
		{"a@@b.com", false},
		{"a b@x.com", false},
	}
	for _, c := range cases {
		if got := EmailOK(c.email); got != c.want {
			t.Errorf("EmailOK(%q)=%v want %v", c.email, got, c.want)
		}
	}
	if EmailOK(padTo(255)) {
		t.Error("255 长度应非法")
	}
	if !EmailOK(padTo(254)) {
		t.Error("254 长度应合法")
	}
	if got := NormalizeEmail("  MIXED@Case.COM "); got != "mixed@case.com" {
		t.Errorf("NormalizeEmail=%q", got)
	}
}

func padTo(n int) string {
	suffix := "@e.co"
	b := make([]byte, n-len(suffix))
	for i := range b {
		b[i] = 'a'
	}
	return string(b) + suffix
}

func TestSlugRules_UTID08(t *testing.T) {
	if SlugOK("abc") || !SlugOK("abcd") {
		t.Error("slug 最短 4 字符边界（正则 1+2+1）")
	}
	if SlugOK("a-b-") || SlugOK("-ab") || SlugOK("AB") {
		t.Error("首尾 '-' 与大写应非法")
	}
	if !SlugReserved("AUTH") || SlugReserved("my-slug") {
		t.Error("保留字应大小写不敏感且不误伤")
	}
}

func TestUUIDOK_UTID09(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"123e4567-e89b-12d3-a456-426614174000", true},
		{"123E4567-E89B-12D3-A456-426614174000", true},
		{"", false},
		{"123e4567e89b12d3a456426614174000", false},
		{"123e4567-e89b-12d3-a456-42661417400", false},
		{"123e4567-e89b-12d3-a456-42661417400g", false},
	}
	for _, c := range cases {
		if got := UUIDOK(c.in); got != c.want {
			t.Errorf("UUIDOK(%q)=%v want %v", c.in, got, c.want)
		}
	}
}

func TestNormalizeDisplayName_FT28(t *testing.T) {
	cases := []struct {
		name   string
		raw    string
		want   string
		wantOK bool
	}{
		{"空串", "", "", false},
		{"纯空白", "   \t\n  ", "", false},
		{"trim 归一", "  张三  ", "张三", true},
		{"100 rune 恰好合法（多字节）", strings.Repeat("世", 100), strings.Repeat("世", 100), true},
		{"101 rune 越界（多字节）", strings.Repeat("世", 101), "", false},
		{"101 rune 越界（单字节）", strings.Repeat("a", 101), "", false},
		{"1.2MB 超大值拒", strings.Repeat("x", 1_200_000), "", false},
	}
	for _, c := range cases {
		got, ok := NormalizeDisplayName(c.raw)
		if ok != c.wantOK {
			t.Errorf("%s: ok=%v want %v", c.name, ok, c.wantOK)
		}
		if c.wantOK && got != c.want {
			t.Errorf("%s: got=%q want %q", c.name, got, c.want)
		}
	}
}
