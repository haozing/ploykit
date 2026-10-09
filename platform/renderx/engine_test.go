package renderx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

const testBundle = `
globalThis.__ploykit_routes__ = function () {
  return JSON.stringify([
    { path: '/', pageId: 'page', render: 'static' },
    { path: '/eval', pageId: 'eval', render: 'static' },
    { path: '/slow/:id', pageId: 'slow', render: 'static' }
  ]);
};
globalThis.__ploykit_render__ = function (pageId, location, propsJson) {
  if (pageId === 'slow') { var a = []; while (true) { a.push(new Array(4096).fill(1)); } }
  var props = propsJson ? JSON.parse(propsJson) : {};
  if (pageId === 'eval') {
    // 探针源码包一层函数体，允许用例写顶层 return（QuickJS 的 eval 不接受裸 return）。
    return JSON.stringify({ html: String(eval('(function(){' + props.src + '})()')), directives: [] });
  }
  globalThis.__ploykit_host__.directive('head', [{ tag: 'title', children: props.title || 'untitled' }]);
  return JSON.stringify({ html: '<main data-page="' + pageId + '">' + (props.title || '') + '</main>', directives: [] });
};
`

func newTestPool(t *testing.T, opts PoolOptions) *EnginePool {
	t.Helper()
	p, err := NewEnginePool([]byte(testBundle), opts)
	if err != nil {
		t.Fatalf("NewEnginePool: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func evalInPool(t *testing.T, p *EnginePool, src string) string {
	t.Helper()
	res, err := p.Render(context.Background(), "eval", "/eval", json.RawMessage(`{"src":`+quoteJSON(src)+`}`))
	if err != nil {
		t.Fatalf("eval %q: %v", src, err)
	}
	return res.HTML
}

func quoteJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestPreludeShims(t *testing.T) {
	p := newTestPool(t, PoolOptions{})

	cases := []struct {
		name        string
		src         string
		wantExact   string
		wantContain string
	}{
		{
			name:        "setTimeout 注册即抛错（N2 显式化）",
			src:         `try { setTimeout(function(){}); return 'NO_THROW'; } catch (e) { return 'THROW:' + e.message; }`,
			wantContain: "异步调度",
		},
		{
			name:        "setImmediate 注册即抛错",
			src:         `try { setImmediate(function(){}); return 'NO_THROW'; } catch (e) { return 'THROW:' + e.message; }`,
			wantContain: "异步调度",
		},
		{
			name:        "setInterval 注册即抛错",
			src:         `try { setInterval(function(){}); return 'NO_THROW'; } catch (e) { return 'THROW:' + e.message; }`,
			wantContain: "异步调度",
		},
		{
			name:      "window 未注入（访问即 ReferenceError，G5）",
			src:       `try { window; return 'NO_REF'; } catch (e) { return e.constructor.name; }`,
			wantExact: "ReferenceError",
		},
		{
			name:      "fetch 未注入",
			src:       `try { fetch('http://x'); return 'NO_REF'; } catch (e) { return e.constructor.name; }`,
			wantExact: "ReferenceError",
		},
		{
			name:      "document 未注入",
			src:       `try { document; return 'NO_REF'; } catch (e) { return e.constructor.name; }`,
			wantExact: "ReferenceError",
		},
		{

			name:      "TextEncoder 可用且编码正确",
			src:       `var b = new TextEncoder().encode('a€'); return b.length + ':' + b[0] + ',' + b[1];`,
			wantExact: "4:97,226",
		},
		{
			name:      "TextDecoder 可用且解码正确",
			src:       `return new TextDecoder().decode(new Uint8Array([97, 226, 130, 172]));`,
			wantExact: "a€",
		},
		{
			name:      "URL 可用（react-router 依赖链子集）",
			src:       `var u = new URL('http://example.com/x?y=1#z'); return u.pathname + '|' + u.origin + '|' + u.search;`,
			wantExact: "/x|http://example.com|?y=1",
		},
		{
			name:      "MessageChannel 可用（react-dom 求值期探测）",
			src:       `return typeof new MessageChannel().port1.postMessage;`,
			wantExact: "function",
		},
		{
			name:      "process 防御性存在",
			src:       `return typeof process;`,
			wantExact: "object",
		},
		{
			name:      "指令宿主已注入",
			src:       `return typeof globalThis.__ploykit_host__.directive;`,
			wantExact: "function",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := evalInPool(t, p, tc.src)
			switch {
			case tc.wantExact != "" && got != tc.wantExact:
				t.Errorf("求值结果 = %q, want %q", got, tc.wantExact)
			case tc.wantExact == "" && !strings.Contains(got, tc.wantContain):
				t.Errorf("求值结果 = %q, want 包含 %q", got, tc.wantContain)
			}
		})
	}
}

func TestMemoryLimitFence(t *testing.T) {

	p := newTestPool(t, PoolOptions{MemoryLimit: 32 << 20})

	bomb := `(function(){var a=[];for(var i=0;i<200;i++){a.push(new Array(524288).fill(i));}return 'done'})()`
	_, err := p.Render(context.Background(), "eval", "/eval", json.RawMessage(`{"src":`+quoteJSON(bomb)+`}`))
	if err == nil {
		t.Fatal("内存炸弹未被拦截（SetMemoryLimit 未生效）")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "memory") {
		t.Errorf("炸弹报错应提及 memory，got: %v", err)
	}

	if got := evalInPool(t, p, `return 1 + 1;`); got != "2" {
		t.Errorf("炸弹后的下一次求值 = %q, want 2", got)
	}
}

func TestEngineWatchdogBusyLoop(t *testing.T) {

	p := newTestPool(t, PoolOptions{Size: 1, RenderTimeout: 300 * time.Millisecond, MemoryLimit: 256 << 20})
	p.mu.Lock()
	corpse := p.instances[0]
	p.mu.Unlock()

	start := time.Now()
	_, err := p.Render(context.Background(), "slow", "/slow/1", nil)
	elapsed := time.Since(start)

	if !errors.Is(err, ErrRenderTimeout) && !strings.Contains(err.Error(), "out of memory") {
		t.Fatalf("死循环渲染应返回 ErrRenderTimeout 或内存上限 OOM, got: %v", err)
	}

	if elapsed > 2*time.Second {
		t.Errorf("超时路径耗时 %v，远超预期（看门狗被重建阻塞？）", elapsed)
	}

	res, err := p.Render(context.Background(), "page", "/", json.RawMessage(`{"title":"after-timeout"}`))
	if err != nil {
		t.Fatalf("超时后的渲染失败: %v", err)
	}
	if !strings.Contains(res.HTML, "after-timeout") {
		t.Errorf("超时后的渲染 html = %q", res.HTML)
	}

	routes, err := p.Routes(context.Background())
	if err != nil {
		t.Fatalf("超时后的 Routes 失败: %v", err)
	}
	if len(routes) != 3 {
		t.Errorf("Routes 返回 %d 条, want 3", len(routes))
	}

	select {
	case <-corpse.exited:
	case <-time.After(30 * time.Second):
		t.Fatal("分配型 corpse 未在 30s 内因内存上限退出（GC 毒化风险）")
	}
}

func TestConcurrentRenderSinkIsolation(t *testing.T) {
	p := newTestPool(t, PoolOptions{Size: 2})

	const n = 12
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			title := fmt.Sprintf("title-%02d", i)
			res, err := p.Render(context.Background(), "page", "/", json.RawMessage(`{"title":`+quoteJSON(title)+`}`))
			if err != nil {
				errs <- fmt.Errorf("渲染 %s: %w", title, err)
				return
			}
			if !strings.Contains(res.HTML, title) {
				errs <- fmt.Errorf("渲染 %s 的 html 串页: %q", title, res.HTML)
				return
			}

			entries, err := HeadEntries(res.Sink.Directives())
			if err != nil {
				errs <- err
				return
			}
			if len(entries) != 1 || entries[0].Children != title {
				errs <- fmt.Errorf("渲染 %s 的指令串页: %+v", title, entries)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}
}

func TestRenderContractAndProps(t *testing.T) {
	p := newTestPool(t, PoolOptions{})

	t.Run("空 props 归一为 {}", func(t *testing.T) {
		res, err := p.Render(context.Background(), "page", "/", nil)
		if err != nil {
			t.Fatal(err)
		}

		entries, err := HeadEntries(res.Sink.Directives())
		if err != nil || len(entries) != 1 || entries[0].Children != "untitled" {
			t.Errorf("空 props 的指令 = %+v (err=%v), want 缺省 title untitled", entries, err)
		}
	})

	t.Run("对象形状的 __ploykit_render__ 返回值（m0 fixture 形状）", func(t *testing.T) {

		objBundle := strings.Replace(testBundle,
			"return JSON.stringify({ html: String(eval('(function(){' + props.src + '})()')), directives: [] });",
			"return { html: String(eval('(function(){' + props.src + '})()')), directives: [] };", 1)
		p2, err := NewEnginePool([]byte(objBundle), PoolOptions{})
		if err != nil {
			t.Fatal(err)
		}
		defer p2.Close()
		if got := evalInPool(t, p2, `return 'obj-shape';`); got != "obj-shape" {
			t.Errorf("对象形状返回值解析失败: %q", got)
		}
	})

	t.Run("props 超过 MaxPropsBytes 直接失败", func(t *testing.T) {
		big := json.RawMessage(`{"pad":"` + strings.Repeat("x", MaxPropsBytes) + `"}`)
		_, err := p.Render(context.Background(), "page", "/", big)
		if !errors.Is(err, ErrPropsTooLarge) {
			t.Errorf("超大 props 应返回 ErrPropsTooLarge, got: %v", err)
		}
	})

	t.Run("props 非法 JSON 直接失败", func(t *testing.T) {
		_, err := p.Render(context.Background(), "page", "/", json.RawMessage(`{"broken":`))
		if err == nil || !strings.Contains(err.Error(), "props") {
			t.Errorf("非法 JSON props 应报错, got: %v", err)
		}
	})

	t.Run("页面内 JS 异常透传为错误（A1/G5）", func(t *testing.T) {
		_, err := p.Render(context.Background(), "eval", "/eval", json.RawMessage(`{"src":"null.x"}`))
		if err == nil {
			t.Error("页面异常应作为错误返回")
		}
	})

	t.Run("pageID/location 缺失报错", func(t *testing.T) {
		if _, err := p.Render(context.Background(), "", "/", nil); err == nil {
			t.Error("空 pageID 应报错")
		}
		if _, err := p.Render(context.Background(), "page", "", nil); err == nil {
			t.Error("空 location 应报错")
		}
	})
}

func TestRenderResultOver64KB(t *testing.T) {

	p := newTestPool(t, PoolOptions{})
	src := `return 'x'.repeat(70000);`
	res, err := p.Render(context.Background(), "eval", "/eval", json.RawMessage(`{"src":`+quoteJSON(src)+`}`))
	if err != nil {
		t.Fatalf("70KB 渲染结果: %v", err)
	}
	if len(res.HTML) != 70000 {
		t.Errorf("渲染结果长度 = %d, want 70000（被 64KB 截断？）", len(res.HTML))
	}
}

func TestInstanceLongevityLoop(t *testing.T) {

	p := newTestPool(t, PoolOptions{Size: 1})
	for i := range 500 {
		title := fmt.Sprintf("loop-%03d", i)
		res, err := p.Render(context.Background(), "page", "/", json.RawMessage(`{"title":`+quoteJSON(title)+`}`))
		if err != nil {
			t.Fatalf("第 %d 次渲染: %v", i, err)
		}
		if !strings.Contains(res.HTML, title) {
			t.Fatalf("第 %d 次渲染串页: %q", i, res.HTML)
		}
		if _, err := HeadEntries(res.Sink.Directives()); err != nil {
			t.Fatalf("第 %d 次渲染指令: %v", i, err)
		}
	}
}

func TestRoutes(t *testing.T) {
	p := newTestPool(t, PoolOptions{})
	routes, err := p.Routes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := []RouteSpec{
		{Path: "/", PageID: "page", Render: ModeStatic},
		{Path: "/eval", PageID: "eval", Render: ModeStatic},
		{Path: "/slow/:id", PageID: "slow", Render: ModeStatic},
	}
	if len(routes) != len(want) {
		t.Fatalf("Routes 返回 %d 条: %+v", len(routes), routes)
	}
	for i, w := range want {
		if routes[i] != w {
			t.Errorf("路由[%d] = %+v, want %+v", i, routes[i], w)
		}
	}
}

func TestRoutesRejectsBadProjection(t *testing.T) {

	bad := strings.Replace(testBundle, `{ path: '/', pageId: 'page', render: 'static' }`,
		`{ path: '/', pageId: 'page', render: 'ssr' }`, 1)
	p, err := NewEnginePool([]byte(bad), PoolOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if _, err := p.Routes(context.Background()); err == nil || !strings.Contains(err.Error(), "非法") {
		t.Errorf("render:ssr 投影应被拒, got: %v", err)
	}
}

type fakeRenderer struct{ routes []RouteSpec }

func (f fakeRenderer) Routes(context.Context) ([]RouteSpec, error) { return f.routes, nil }
func (f fakeRenderer) Render(context.Context, string, string, json.RawMessage) (RenderResult, error) {
	return RenderResult{}, nil
}

func TestReconcileEngineMissingPaths(t *testing.T) {

	r := fakeRenderer{routes: []RouteSpec{{Path: "/probe-missing/:slug", PageID: "probe", Render: ModeStatic}}}
	err := ReconcileEngine(context.Background(), r)
	if !errors.Is(err, ErrMissingPaths) {
		t.Errorf("缺 Paths 应返回 ErrMissingPaths, got: %v", err)
	}
}

func TestReconcileEngineOK(t *testing.T) {

	r := fakeRenderer{routes: []RouteSpec{
		{Path: "/", PageID: "landing", Render: ModeStatic},
		{Path: "/app", PageID: "app", Render: ModeCSR},
	}}
	if err := ReconcileEngine(context.Background(), r); err != nil {
		t.Fatalf("对账应通过: %v", err)
	}
}

func TestPoolCloseDrains(t *testing.T) {
	p := newTestPool(t, PoolOptions{Size: 2})

	res, err := p.Render(context.Background(), "page", "/", json.RawMessage(`{"title":"before-close"}`))
	if err != nil || !strings.Contains(res.HTML, "before-close") {
		t.Fatalf("Close 前渲染: %v %q", err, res.HTML)
	}

	p.Close()
	p.Close()

	if _, err := p.Render(context.Background(), "page", "/", nil); !errors.Is(err, ErrPoolClosed) {
		t.Errorf("Close 后渲染应返回 ErrPoolClosed, got: %v", err)
	}
	if _, err := p.Routes(context.Background()); !errors.Is(err, ErrPoolClosed) {
		t.Errorf("Close 后 Routes 应返回 ErrPoolClosed, got: %v", err)
	}
}
