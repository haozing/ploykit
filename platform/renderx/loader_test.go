package renderx

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestMatch(t *testing.T) {
	cases := []struct {
		name       string
		pattern    string
		path       string
		wantOK     bool
		wantParams Params
	}{
		{"根路径", "/", "/", true, nil},
		{"字面量命中", "/pricing", "/pricing", true, nil},
		{"字面量不中", "/pricing", "/about", false, nil},
		{"参数提取", "/blog/:slug", "/blog/hello", true, Params{"slug": "hello"}},
		{"参数含连字符下划线", "/blog/:slug", "/blog/my-post_1", true, Params{"slug": "my-post_1"}},
		{"段数不足", "/blog/:slug", "/blog", false, nil},
		{"段数超出", "/blog/:slug", "/blog/a/b", false, nil},
		{"参数不匹配空段", "/blog/:slug", "/blog/", false, nil},
		{"多参数", "/blog/:slug/comments/:cid", "/blog/a/comments/b", true, Params{"slug": "a", "cid": "b"}},
		{"混排后段不中", "/blog/:slug/edit", "/blog/a/likes", false, nil},
		{"混排命中", "/blog/:slug/edit", "/blog/x/edit", true, Params{"slug": "x"}},
		{"大小写敏感", "/Blog", "/blog", false, nil},
		{"前缀相同后缀不同", "/blog", "/blogs", false, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			params, ok := Match(c.pattern, c.path)
			if ok != c.wantOK {
				t.Fatalf("Match(%q, %q) ok = %v, want %v", c.pattern, c.path, ok, c.wantOK)
			}
			if !c.wantOK {
				return
			}
			if len(params) != len(c.wantParams) {
				t.Fatalf("params = %v, want %v", params, c.wantParams)
			}
			for k, v := range c.wantParams {
				if params[k] != v {
					t.Fatalf("params[%s] = %q, want %q", k, params[k], v)
				}
			}
		})
	}
}

func TestValidParamValue(t *testing.T) {
	valid := []string{"a", "A-b_0", "hello-world", strings.Repeat("x", 256)}
	invalid := []string{
		"", "..", "../x", "a/b", "a b", "a.b", "a%20b", "%2e%2e", "a\\b", "a:b",
		"café", strings.Repeat("x", 257),
	}
	for _, v := range valid {
		if !ValidParamValue(v) {
			t.Errorf("ValidParamValue(%q) = false, want true", v)
		}
	}
	for _, v := range invalid {
		if ValidParamValue(v) {
			t.Errorf("ValidParamValue(%q) = true, want false", v)
		}
	}
	if err := ValidateParams(Params{"slug": "../etc/passwd"}); !errors.Is(err, ErrInvalidParam) {
		t.Errorf("ValidateParams want ErrInvalidParam, got %v", err)
	}
	if err := ValidateParams(Params{"slug": "ok"}); err != nil {
		t.Errorf("ValidateParams ok case failed: %v", err)
	}
}

func TestValidPattern(t *testing.T) {
	valid := []string{"/", "/a", "/a/:b", "/a/:b_c1/d", "/blog/:slug"}
	invalid := []string{"", "a", "/a/", "/a//b", "/:/x", "/a/:", "/a/:b:c", "/a:b"}
	for _, p := range valid {
		if !validPattern(p) {
			t.Errorf("validPattern(%q) = false, want true", p)
		}
	}
	for _, p := range invalid {
		if validPattern(p) {
			t.Errorf("validPattern(%q) = true, want false", p)
		}
	}
}

func dummyPaths(context.Context) ([]PagePath, error)   { return nil, nil }
func dummyLoader(context.Context, Params) (any, error) { return nil, nil }

func TestReconcileMissingPaths(t *testing.T) {
	r := NewRegistry()
	r.RegisterLoader("/blog/:slug", dummyLoader)
	err := r.Reconcile([]RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic},
	})
	if !errors.Is(err, ErrMissingPaths) {
		t.Fatalf("want ErrMissingPaths, got %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, `/blog/:slug`) || !strings.Contains(msg, "renderx.Paths(") {
		t.Errorf("错误信息应带缺失路径与示例代码：\n%s", msg)
	}
}

func TestReconcilePatternDrift(t *testing.T) {
	r := NewRegistry()
	r.RegisterPaths("/blog/:slug", dummyPaths)
	r.RegisterLoader("/blogs/:slug", dummyLoader)
	r.RegisterDep("/", "/blog/:slug")
	err := r.Reconcile([]RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic},
	})
	if !errors.Is(err, ErrPatternMismatch) {
		t.Fatalf("want ErrPatternMismatch, got %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "/blogs/:slug") || !strings.Contains(msg, "renderx.Loader(") || !strings.Contains(msg, "/blog/:slug") {
		t.Errorf("错误信息应带漂移键、示例代码与路由表现状：\n%s", msg)
	}
}

func TestReconcileDepDrift(t *testing.T) {
	r := NewRegistry()
	r.RegisterPaths("/blog/:slug", dummyPaths)
	r.RegisterDep("/", "/tags/:tag")
	err := r.Reconcile([]RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic},
	})
	if !errors.Is(err, ErrPatternMismatch) {
		t.Fatalf("want ErrPatternMismatch, got %v", err)
	}
	if !strings.Contains(err.Error(), "Dep") {
		t.Errorf("错误应标注来源 Dep：\n%s", err)
	}
}

func TestReconcileOK(t *testing.T) {
	r := NewRegistry()
	r.RegisterPaths("/blog/:slug", dummyPaths)
	r.RegisterLoader("/blog/:slug", dummyLoader)
	r.RegisterDep("/", "/blog/:slug")
	err := r.Reconcile([]RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/pricing", PageID: "pricing", Render: ModeStatic},
		{Path: "/app", PageID: "dashboard", Render: ModeCSR},
		{Path: "/blog/:slug", PageID: "blog-post", Render: ModeStatic},
	})
	if err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}

func TestAffectedPatternsClosure(t *testing.T) {
	r := NewRegistry()
	r.RegisterDep("/a", "/b")
	r.RegisterDep("/c", "/a")
	r.RegisterDep("/d", "/b")

	cases := []struct {
		pattern string
		want    []string
	}{

		{"/b", []string{"/b", "/a", "/d", "/c"}},
		{"/a", []string{"/a", "/c"}},
		{"/c", []string{"/c"}},
		{"/x", []string{"/x"}},
	}
	for _, c := range cases {
		got := r.AffectedPatterns(c.pattern)
		if len(got) != len(c.want) {
			t.Fatalf("AffectedPatterns(%q) = %v, want %v", c.pattern, got, c.want)
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Fatalf("AffectedPatterns(%q) = %v, want %v", c.pattern, got, c.want)
			}
		}
	}
}

func TestAffectedPatternsDedup(t *testing.T) {
	r := NewRegistry()
	r.RegisterDep("/a", "/b")
	r.RegisterDep("/a", "/b")
	got := r.AffectedPatterns("/b")
	if len(got) != 2 || got[0] != "/b" || got[1] != "/a" {
		t.Fatalf("want [/b /a], got %v", got)
	}
}

func TestRegisterPanics(t *testing.T) {
	cases := []struct {
		name string
		fn   func(r *Registry)
	}{
		{"Paths 重复", func(r *Registry) { r.RegisterPaths("/a", dummyPaths); r.RegisterPaths("/a", dummyPaths) }},
		{"Loader 重复", func(r *Registry) { r.RegisterLoader("/a", dummyLoader); r.RegisterLoader("/a", dummyLoader) }},
		{"模式无前导斜杠", func(r *Registry) { r.RegisterPaths("blog/:slug", dummyPaths) }},
		{"模式双斜杠", func(r *Registry) { r.RegisterPaths("/a//b", dummyPaths) }},
		{"Dep 自环", func(r *Registry) { r.RegisterDep("/a", "/a") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Errorf("%s 应 panic", c.name)
				}
			}()
			c.fn(NewRegistry())
		})
	}
}

func TestLookup(t *testing.T) {
	r := NewRegistry()
	if _, err := r.LookupPaths("/blog/:slug"); !errors.Is(err, ErrPatternNotFound) {
		t.Errorf("want ErrPatternNotFound, got %v", err)
	}
	if _, err := r.LookupLoader("/blog/:slug"); !errors.Is(err, ErrPatternNotFound) {
		t.Errorf("want ErrPatternNotFound, got %v", err)
	}
	r.RegisterPaths("/blog/:slug", dummyPaths)
	r.RegisterLoader("/blog/:slug", dummyLoader)
	if _, err := r.LookupPaths("/blog/:slug"); err != nil {
		t.Errorf("LookupPaths: %v", err)
	}
	if _, err := r.LookupLoader("/blog/:slug"); err != nil {
		t.Errorf("LookupLoader: %v", err)
	}
}

func TestDefaultRegistryWrappers(t *testing.T) {
	ResetForTest()
	t.Cleanup(ResetForTest)
	RegisterPaths("/default-only/:id", dummyPaths)
	RegisterDep("/default-only-home", "/default-only/:id")
	err := Reconcile([]RouteSpec{
		{Path: "/default-only/:id", PageID: "p1", Render: ModeStatic},
		{Path: "/default-only-home", PageID: "p2", Render: ModeStatic},
	})
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	got := AffectedPatterns("/default-only/:id")
	if len(got) != 2 {
		t.Fatalf("AffectedPatterns = %v, want 2 项", got)
	}
}

func TestDefaultRegistryRepeatable(t *testing.T) {
	t.Cleanup(ResetForTest)
	round := func(n int) {
		RegisterPaths("/repeat/:id", dummyPaths)
		RegisterLoader("/repeat/:id", dummyLoader)
		RegisterDep("/repeat-home", "/repeat/:id")
		if err := Reconcile([]RouteSpec{
			{Path: "/repeat/:id", PageID: "p1", Render: ModeStatic},
			{Path: "/repeat-home", PageID: "p2", Render: ModeStatic},
		}); err != nil {
			t.Fatalf("第 %d 轮 Reconcile: %v", n, err)
		}
		if got := AffectedPatterns("/repeat/:id"); len(got) != 2 {
			t.Fatalf("第 %d 轮 AffectedPatterns = %v, want 2 项", n, got)
		}
	}
	ResetForTest()
	round(1)
	ResetForTest()
	round(2)
}
