package app

// WithProviderSource 热源的内部测试（package app：TTL 缝 hotTTL/hotLoaded
// 未导出）。行为面（Start/Callback 走热集）由 service_oauth_test.go 的外部
// 测试覆盖，这里钉死缓存语义：TTL 内定格、过期重建、空集快照、并发安全。
//
// ⚠️ Windows 时钟粒度陷阱（2026-10-31 本机实测：相邻 time.Now() 99.999%
// 同值）：TTL 缩到 1ns 无法强制过期——now == loaded 时 Before(loaded+1ns)
// 恒真。测过期一律走 expire() 回拨 hotLoaded（确定性），真实 TTL 到期
// 只在一个用例里用 sleep≥10ms 验证（粒度安全余量）。

import (
	"context"
	"sync"
	"testing"
	"time"
)

type srcFake struct{ name string }

func (f srcFake) Name() string                             { return f.name }
func (f srcFake) AuthURL(state, redirectURI string) string { return "" }
func (f srcFake) Exchange(ctx context.Context, code, redirectURI string) (OAuthIdentity, error) {
	return OAuthIdentity{}, nil
}

// expire 确定性把当前快照拨过期（写锁内回拨 hotLoaded 一小时）。
func expire(t *testing.T, s *OAuthService) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.hotLoaded.IsZero() {
		t.Fatal("expire called before first snapshot build")
	}
	s.hotLoaded = s.hotLoaded.Add(-time.Hour)
}

func TestOAuthSource_TTLCacheAndRebuild(t *testing.T) {
	current := []OAuthProvider{srcFake{"a"}}
	builds := 0
	s := NewOAuthService(nil, nil, func() time.Time { return time.Now() })
	s.WithProviderSource(func() []OAuthProvider {
		builds++
		out := make([]OAuthProvider, len(current))
		copy(out, current)
		return out
	})

	// 首读构建，TTL 内（默认 30s）定格：连读三次只构建一次。
	for i := 0; i < 3; i++ {
		if got := s.Names(); len(got) != 1 || got[0] != "a" {
			t.Fatalf("names = %v, want [a]", got)
		}
	}
	if builds != 1 {
		t.Fatalf("builds = %d, want 1 (TTL 内必须定格)", builds)
	}

	// 过期后重建：换源内容 + 回拨 hotLoaded → 下次读看到新集。
	current = []OAuthProvider{srcFake{"b"}, srcFake{"c"}}
	expire(t, s)
	got := s.Names()
	if len(got) != 2 || got[0] != "b" || got[1] != "c" {
		t.Fatalf("after swap names = %v, want [b c]", got)
	}
	if builds != 2 {
		t.Fatalf("builds = %d, want 2", builds)
	}
	if _, ok := s.provider("a"); ok {
		t.Fatal("provider(a) should be gone after swap")
	}
	if _, ok := s.provider("c"); !ok {
		t.Fatal("provider(c) should be present after swap")
	}
}

func TestOAuthSource_RealTTLExpiry(t *testing.T) {
	// 真实到期路径（不走 expire）：TTL 缩到 10ms，sleep 15ms 后必过期。
	// sleep 余量 > Windows 时钟粒度（本机实测 ~500µs+）。
	s := NewOAuthService(nil, nil, func() time.Time { return time.Now() })
	s.WithProviderSource(func() []OAuthProvider { return []OAuthProvider{srcFake{"a"}} })
	s.mu.Lock()
	s.hotTTL = 10 * time.Millisecond
	s.mu.Unlock()

	if got := s.Names(); len(got) != 1 {
		t.Fatalf("names = %v, want [a]", got)
	}
	time.Sleep(15 * time.Millisecond)
	s.Names() // 过期 → 真实重建
	s.mu.RLock()
	loaded := s.hotLoaded
	s.mu.RUnlock()
	time.Sleep(15 * time.Millisecond)
	s.Names() // 再次过期 → 再次重建
	s.mu.RLock()
	loaded2 := s.hotLoaded
	s.mu.RUnlock()
	if !loaded2.After(loaded) {
		t.Fatal("snapshot must rebuild after real TTL expiry")
	}
}

func TestOAuthSource_EmptyIsASnapshot(t *testing.T) {
	calls := 0
	s := NewOAuthService(nil, nil, func() time.Time { return time.Now() })
	s.WithProviderSource(func() []OAuthProvider {
		calls++
		return nil // 读失败降级 = 全部停用，必须成快照而非永动重建
	})
	for i := 0; i < 3; i++ {
		if i > 0 {
			expire(t, s) // 读前过期，保证本轮回调源
		}
		if got := s.Names(); len(got) != 0 {
			t.Fatalf("names = %v, want empty", got)
		}
	}
	if calls != 3 {
		t.Fatalf("source calls = %d, want 3", calls)
	}
	// hot 快照非 nil（空切片），hotByName 为空 map。
	s.mu.RLock()
	hot, byName := s.hot, s.hotByName
	s.mu.RUnlock()
	if hot == nil || len(hot) != 0 {
		t.Fatalf("hot snapshot = %v, want non-nil empty", hot)
	}
	if byName == nil {
		t.Fatal("hotByName must never be nil")
	}
}

func TestOAuthSource_StaticPathUnchanged(t *testing.T) {
	// back-compat：无热源时静态集路径不走锁、行为不变。
	s := NewOAuthService(nil, []OAuthProvider{srcFake{"google"}}, nil)
	if got := s.Names(); len(got) != 1 || got[0] != "google" {
		t.Fatalf("static names = %v", got)
	}
	if _, ok := s.provider("google"); !ok {
		t.Fatal("static provider(google) missing")
	}
	// WithProviderSource(nil) 是 no-op（func 只能比 nil，验证静态集不受影响）。
	s.WithProviderSource(nil)
	if got := s.Names(); len(got) != 1 || got[0] != "google" {
		t.Fatalf("static names after nil source = %v", got)
	}
}

func TestOAuthSource_ConcurrentReadsWhileHotSwap(t *testing.T) {
	// 并发 Names()/provider() 与过期重建交错（CI -race 主战场；本机
	// Windows 跑不了 TSan，靠锁纪律 + CI 兜底）。
	var mu sync.Mutex
	set := []string{"a", "b"}
	s := NewOAuthService(nil, nil, func() time.Time { return time.Now() })
	s.WithProviderSource(func() []OAuthProvider {
		mu.Lock()
		defer mu.Unlock()
		out := make([]OAuthProvider, len(set))
		for i, n := range set {
			out[i] = srcFake{n}
		}
		return out
	})

	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				for _, n := range s.Names() {
					s.provider(n)
				}
				s.provider("nope")
			}
		}()
	}
	for round := 0; round < 200; round++ {
		mu.Lock()
		if round%2 == 0 {
			set = []string{"a", "b", "c"}
		} else {
			set = []string{"a"}
		}
		mu.Unlock()
		s.mu.Lock()
		if !s.hotLoaded.IsZero() {
			s.hotLoaded = s.hotLoaded.Add(-time.Hour) // 读者们持续强制过期
		}
		s.mu.Unlock()
		time.Sleep(50 * time.Microsecond)
	}
	close(stop)
	wg.Wait()
}
