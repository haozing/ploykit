package renderx

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMemoryLimitOverUint32Rejected(t *testing.T) {
	_, err := NewEnginePool([]byte(testBundle), PoolOptions{MemoryLimit: 5 << 30})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "uint32")

	p, err := NewEnginePool([]byte(testBundle), PoolOptions{MemoryLimit: math.MaxUint32, Size: 1})
	require.NoError(t, err, "恰为 4GiB 不应被拒（uint32 可表示）")
	p.Close()
}

func TestGetOrLoadLeaderCancelNoCascade(t *testing.T) {
	c, err := NewLayeredCache(CacheConfig{BuildID: "b1"})
	require.NoError(t, err)

	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	inLoad := make(chan struct{})
	release := make(chan struct{})
	load := func(ctx context.Context) (CacheEntry, error) {
		close(inLoad)
		<-release
		return CacheEntry{HTML: []byte("<html>leader</html>"), PropsSHA256: "s1"}, nil
	}

	leaderDone := make(chan struct{})
	go func() {
		defer close(leaderDone)
		_, _ = c.GetOrLoad(leaderCtx, "/a", load)
	}()
	<-inLoad

	var wg sync.WaitGroup
	var followerErr error
	var followerHTML string
	wg.Add(1)
	go func() {
		defer wg.Done()
		ent, err := c.GetOrLoad(context.Background(), "/a", load)
		followerErr = err
		followerHTML = string(ent.HTML)
	}()
	time.Sleep(50 * time.Millisecond)

	cancelLeader()
	close(release)

	wg.Wait()
	<-leaderDone
	require.NoError(t, followerErr, "等待者不得连坐首调用者的取消")
	assert.Equal(t, "<html>leader</html>", followerHTML)

	ent, ok := c.Get(context.Background(), "/a")
	require.True(t, ok, "断连后的取数结果仍应写缓存")
	assert.Equal(t, "<html>leader</html>", string(ent.HTML))
}

func TestMatchStaticSpecificity(t *testing.T) {
	statics := []RouteSpec{
		{Path: "/:a/:b", PageID: "catch2", Render: ModeStatic},
		{Path: "/blog/:slug", PageID: "blog", Render: ModeStatic},
		{Path: "/:a/:b/:c", PageID: "catch3", Render: ModeStatic},
	}
	rt, params, ok := matchStatic(statics, "/blog/hello")
	require.True(t, ok)
	assert.Equal(t, "blog", rt.PageID, "更特异的 /blog/:slug 必须胜过声明在前的 /:a/:b")
	assert.Equal(t, Params{"slug": "hello"}, params)

	rt, _, ok = matchStatic(statics, "/x/y")
	require.True(t, ok)
	assert.Equal(t, "catch2", rt.PageID)

	rt, _, ok = matchStatic(statics, "/x/y/z")
	require.True(t, ok)
	assert.Equal(t, "catch3", rt.PageID)

	rt, _, ok = matchStatic([]RouteSpec{
		{Path: "/blog/:slug", PageID: "blog", Render: ModeStatic},
		{Path: "/blog/hello", PageID: "literal", Render: ModeStatic},
	}, "/blog/hello")
	require.True(t, ok)
	assert.Equal(t, "literal", rt.PageID)
}

func TestDirectiveSinkCaps(t *testing.T) {
	s := NewSink()
	for i := 0; i < maxDirectives; i++ {
		d := s.Append("head", json.RawMessage("[]"))
		require.Equal(t, i+1, d.Seq)
	}
	assert.False(t, s.Truncated(), "恰好到界未越限")

	d := s.Append("head", json.RawMessage("[]"))
	assert.Equal(t, -1, d.Seq, "越限 Append 拒绝落账")
	assert.True(t, s.Truncated(), "越限即置截断标记")
	d = s.Append("head", json.RawMessage("[]"))
	assert.Equal(t, -1, d.Seq, "截断后持久拒绝（不可恢复）")
	assert.Len(t, s.Directives(), maxDirectives, "已落账指令不受影响")

	s2 := NewSink()
	big := json.RawMessage(`"` + strings.Repeat("x", maxDirectiveBytes) + `"`)
	d = s2.Append("head", big)
	assert.Equal(t, -1, d.Seq, "累计体积越限同样拒绝")
	assert.True(t, s2.Truncated())
}

func TestDirectiveFloodKillsRender(t *testing.T) {
	p := newTestPool(t, PoolOptions{RenderTimeout: 20 * time.Second})
	_, err := p.Render(context.Background(), "eval", "/eval", json.RawMessage(`{"src":"for(var i=0;i<100000;i++){__ploykit_host__.directive('head', [{tag:'title'}]);} return 'done'"}`))
	require.Error(t, err, "指令洪流必须让渲染失败")
	assert.Contains(t, err.Error(), "指令数")
}

func TestHeadEntryDenyList(t *testing.T) {
	for _, tag := range []string{"script", "base", "iframe", "object", "embed", "frame", "applet"} {
		_, err := renderHeadEntry(HeadEntry{Tag: tag, Children: "x"})
		require.Error(t, err, "<%s> 必须被拒绝", tag)
		assert.ErrorIs(t, err, ErrInvalidHeadTag)
	}
	_, err := renderHeadEntry(HeadEntry{
		Tag:   "meta",
		Attrs: map[string]string{"http-equiv": "refresh", "content": "0;url=https://evil.example"},
	})
	require.Error(t, err, "meta http-equiv（refresh 重定向载体）必须被拒绝")
	assert.ErrorIs(t, err, ErrInvalidHeadTag)

	_, err = renderHeadEntry(HeadEntry{Tag: "meta", Attrs: map[string]string{"name": "description", "content": "ok"}})
	assert.NoError(t, err)
	_, err = renderHeadEntry(HeadEntry{Tag: "title", Children: "t"})
	assert.NoError(t, err)
	_, err = renderHeadEntry(HeadEntry{Tag: "link", Attrs: map[string]string{"rel": "stylesheet", "href": "/a.css"}})
	assert.NoError(t, err)
}

type bodyTitleRenderer struct{}

func (bodyTitleRenderer) Routes(context.Context) ([]RouteSpec, error) { return nil, nil }
func (bodyTitleRenderer) Render(_ context.Context, _, _ string, _ json.RawMessage) (RenderResult, error) {
	sink := NewSink()
	sink.Append("head", json.RawMessage(`[{"tag":"meta","attrs":{"name":"description","content":"d"}}]`))
	return RenderResult{HTML: "<div>body <title>fake</title></div>", Sink: sink}, nil
}

func TestMissingTitleNotSatisfiedByBodyTitle(t *testing.T) {
	_, err := renderPage(context.Background(), bodyTitleRenderer{}, "p1", "/x", nil, "", ViteAssets{})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrMissingTitle)
}

func TestReplaceInstanceFailureShrinks(t *testing.T) {
	oldNew := newInstanceImpl
	defer func() { newInstanceImpl = oldNew }()

	var calls atomic.Int64
	newInstanceImpl = func(bundle []byte, opts PoolOptions) (*engineInstance, error) {
		if calls.Add(1) == 1 {
			return newInstance(bundle, opts)
		}
		return nil, errors.New("boom: cannot rebuild")
	}

	p, err := NewEnginePool([]byte(testBundle), PoolOptions{Size: 1, RenderTimeout: 20 * time.Second})
	require.NoError(t, err)
	defer p.Close()
	require.Len(t, p.instances, 1)

	inst := p.instances[0]
	p.killInstance(inst)

	require.Eventually(t, func() bool {
		p.mu.Lock()
		defer p.mu.Unlock()
		return len(p.instances) == 0
	}, 3*time.Second, 10*time.Millisecond, "补员失败必须摘除（容量缩水），不得保留尸体")

	assert.NotPanics(t, func() { p.Close() })
}

func TestEvictMatchingDiskDeleteFailure(t *testing.T) {
	c, root := newDiskCache(t, "b1")
	ctx := context.Background()
	require.NoError(t, c.Put(ctx, "/a", CacheEntry{HTML: []byte("a")}))
	require.NoError(t, c.Put(ctx, "/b", CacheEntry{HTML: []byte("b")}))

	blob := filepath.Join(root, "a")
	require.NoError(t, os.Remove(blob))
	require.NoError(t, os.MkdirAll(filepath.Join(blob, "child"), 0o755))

	n, err := c.EvictMatching(ctx, func(k string) bool { return true })
	require.Error(t, err, "磁盘删除失败必须上抛")
	assert.Contains(t, err.Error(), "a")
	assert.Equal(t, 1, n, "失败的键不计入逐出数（b 成功）")

	_, ok := c.Get(ctx, "/b")
	assert.False(t, ok)
	_, ok = c.Get(ctx, "/a")
	assert.False(t, ok, "内存侧照常逐出")
}
