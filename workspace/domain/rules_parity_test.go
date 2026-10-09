package domain

import (
	"strings"
	"testing"

	iddomain "github.com/haozing/ploykit/identity/domain"
)

func TestEmailRulesParity_WA6(t *testing.T) {
	emails := []string{
		"WorkSpace@X.com",
		"  Foo.Bar@Baz.Co  ",
		"user@example.com",
		"a@b.c",
		"",
		"plain",
		"a@b",
		"a b@example.com",
		"a@b@c.com",
		"a@" + strings.Repeat("x", 249) + ".c",
		"a@" + strings.Repeat("x", 250) + ".c",
	}
	for _, e := range emails {
		if got, want := EmailOK(e), iddomain.EmailOK(e); got != want {
			t.Errorf("EmailOK(%q): workspace=%v identity=%v（双份规则漂移）", e, got, want)
		}
		got, want := NormalizeEmail(e), iddomain.NormalizeEmail(e)
		if got != want {
			t.Errorf("NormalizeEmail(%q): workspace=%q identity=%q（双份规则漂移）", e, got, want)
		}
	}

	if got := NormalizeEmail("WorkSpace@X.com"); got != "workspace@x.com" {
		t.Errorf("NormalizeEmail(WorkSpace@X.com)=%q want workspace@x.com", got)
	}
}

func TestSlugRulesParity_WA6(t *testing.T) {
	slugs := []string{
		"acme",
		"my-app",
		"ab",
		"-abc",
		"abc-",
		"ABC",
		"App",
		"api",
		"support",
		"billing",
		"ok-name-2",
		"a",
		"a-b",
		"abc-d",
		"under_score",
		"app.",
		"x-" + strings.Repeat("a", 40),
	}
	for _, s := range slugs {
		if got, want := SlugOK(s), iddomain.SlugOK(s); got != want {
			t.Errorf("SlugOK(%q): workspace=%v identity=%v（双份规则漂移）", s, got, want)
		}
		if got, want := SlugReserved(s), iddomain.SlugReserved(s); got != want {
			t.Errorf("SlugReserved(%q): workspace=%v identity=%v（双份规则漂移）", s, got, want)
		}
	}

	if !SlugReserved("API") || !iddomain.SlugReserved("API") {
		t.Error("SlugReserved(API) 两侧均应为 true（大小写不敏感）")
	}
	if SlugReserved("apis") {
		t.Error("SlugReserved(apis) 应为 false（精确匹配，非前缀）")
	}
}
