package pg

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/internal/contract/apierr"
)

func TestAsNotFound_UTPG02(t *testing.T) {
	fk := &pgconn.PgError{Code: "23503", Message: "foreign key violation"}
	got := AsNotFound(fk, "row referenced elsewhere")
	var apiErr *apierr.Error
	if !errors.As(got, &apiErr) || apiErr.Code != apierr.NotFound {
		t.Errorf("23503 应映射为 NotFound, got %v", got)
	}

	unique := &pgconn.PgError{Code: "23505"}
	if got := AsNotFound(unique, "x"); !errors.As(got, new(*pgconn.PgError)) {
		t.Errorf("非 23503 应透传原始 pg 错误, got %v", got)
	}

	plain := errors.New("boom")
	if got := AsNotFound(plain, "x"); !errors.Is(got, plain) {
		t.Errorf("普通错误应透传, got %v", got)
	}

	if got := AsNotFound(nil, "x"); got != nil {
		t.Errorf("nil 应透传, got %v", got)
	}
}

func TestIsUniqueViolation(t *testing.T) {
	fk := &pgconn.PgError{Code: "23503"}
	if IsUniqueViolation(fk, "") {
		t.Error("23503 不是唯一冲突")
	}
	dup := &pgconn.PgError{Code: "23505", ConstraintName: "task_ws_idem_key"}
	if !IsUniqueViolation(dup, "") {
		t.Error("23505 且不带约束过滤应命中")
	}
	if !IsUniqueViolation(dup, "task_ws_idem_key") {
		t.Error("约束名精确匹配应命中")
	}
	if IsUniqueViolation(dup, "task_ws_number_key") {
		t.Error("约束名不匹配不应命中")
	}
	wrapped := fmt.Errorf("insert task: %w", dup)
	if !IsUniqueViolation(wrapped, "task_ws_idem_key") {
		t.Error("wrapped 23505 应经 errors.As 命中")
	}
	if IsUniqueViolation(nil, "") || IsUniqueViolation(errors.New("boom"), "") {
		t.Error("nil 与普通错误应恒 false")
	}
}

func TestAsDuplicate(t *testing.T) {
	sentinel := errors.New("duplicate resource")
	dup := &pgconn.PgError{Code: "23505"}
	if got := AsDuplicate(dup, sentinel); !errors.Is(got, sentinel) {
		t.Errorf("23505 应翻译为调用方语义错误, got %v", got)
	}
	plain := errors.New("boom")
	if got := AsDuplicate(plain, sentinel); !errors.Is(got, plain) {
		t.Errorf("非 23505 应原样透传, got %v", got)
	}
	if got := AsDuplicate(nil, sentinel); got != nil {
		t.Errorf("nil 应透传, got %v", got)
	}
}

func TestBreaker_UTPG03(t *testing.T) {
	now := time.Unix(1700000000, 0)
	clock := now
	b := breaker{openFor: time.Minute, now: func() time.Time { return clock }}

	if !b.Allow() {
		t.Fatal("初始应放行")
	}
	b.Trip()
	if b.Allow() {
		t.Fatal("Trip 后应拒绝")
	}

	clock = now.Add(30 * time.Second)
	if b.Allow() {
		t.Fatal("冷却未到应仍拒绝")
	}

	clock = now.Add(time.Minute)
	if !b.Allow() {
		t.Fatal("冷却过期应放行")
	}

	clock = now
	b.Trip()
	b.OnSuccess()
	if !b.Allow() {
		t.Fatal("OnSuccess 应复位熔断")
	}
}

func TestDialWithRetryFailures_UTPG07(t *testing.T) {
	_, err := dialWithRetry(context.Background(), "://bad", Options{ConnectTimeout: time.Second})
	require.Error(t, err)
	require.Contains(t, err.Error(), "parse dsn")

	_, err = dialWithRetry(context.Background(), "postgres://pk:pk@127.0.0.1:1/none",
		Options{StartupTimeout: 300 * time.Millisecond, ConnectTimeout: 200 * time.Millisecond})
	require.Error(t, err)
	require.Contains(t, err.Error(), "startup budget exhausted")
}

func TestJitter_UTPG04(t *testing.T) {
	base := time.Second
	for i := 0; i < 200; i++ {
		got := jitter(base)
		if got < base || got > base+base/2 {
			t.Fatalf("jitter(%v)=%v 越界 [%v, %v]", base, got, base, base+base/2)
		}
	}
	if jitter(0) != 0 {
		t.Error("jitter(0) 应为 0")
	}
}

type logSink struct {
	mu   sync.Mutex
	msgs []string
}

func (l *logSink) Enabled(context.Context, slog.Level) bool { return true }

func (l *logSink) Handle(_ context.Context, r slog.Record) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.msgs = append(l.msgs, r.Message)
	return nil
}

func (l *logSink) WithAttrs([]slog.Attr) slog.Handler { return l }
func (l *logSink) WithGroup(string) slog.Handler      { return l }

func (l *logSink) contains(sub string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, m := range l.msgs {
		if strings.Contains(m, sub) {
			return true
		}
	}
	return false
}

func (l *logSink) snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]string, len(l.msgs))
	copy(out, l.msgs)
	return out
}

type fakeNetErr struct{}

func (fakeNetErr) Error() string   { return "fake transient connect failure" }
func (fakeNetErr) Timeout() bool   { return true }
func (fakeNetErr) Temporary() bool { return true }

func TestIsConnectTransientCtxExclusion_UTPG08(t *testing.T) {

	require.False(t, isConnectTransient(context.Canceled))
	require.False(t, isConnectTransient(context.DeadlineExceeded))
	require.False(t, isConnectTransient(fmt.Errorf("query aborted: %w", context.Canceled)))
	require.False(t, isConnectTransient(fmt.Errorf("query aborted: %w", context.DeadlineExceeded)))

	require.True(t, isConnectTransient(&pgconn.ConnectError{}))
	require.True(t, isConnectTransient(fakeNetErr{}))

	require.True(t, isConnectTransient(os.ErrDeadlineExceeded))

	require.False(t, isConnectTransient(nil))
	require.False(t, isConnectTransient(errors.New("forced")))
}

func TestBreakerHalfOpenConcurrentSingleProbe_UTPG09(t *testing.T) {
	base := time.Unix(1780000000, 0)
	now := base
	b := &breaker{openFor: time.Minute, now: func() time.Time { return now }}
	b.Trip()
	now = now.Add(time.Minute)

	var passed atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if b.Allow() {
				passed.Add(1)
			}
		}()
	}
	wg.Wait()
	require.Equal(t, int32(1), passed.Load(), "半开并发恰好放行一个探测者")
}

func TestReadHalfOpenOthersFallBackToPrimary_UTPG10(t *testing.T) {
	base := time.Unix(1780000000, 0)
	now := base
	primaryMark := &pgxpool.Pool{}
	replicaMark := &pgxpool.Pool{}
	d := &DB{primary: primaryMark, breaker: breaker{openFor: time.Minute, now: func() time.Time { return now }}}
	d.replica.Store(replicaMark)

	d.breaker.Trip()
	now = now.Add(time.Minute)

	inReplica := make(chan struct{}, 1)
	releaseProbe := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(releaseProbe) }) }
	t.Cleanup(unblock)

	var replicaCalls, primaryCalls atomic.Int32
	fn := func(_ context.Context, q DBTX) error {
		if q == DBTX(replicaMark) {
			replicaCalls.Add(1)
			inReplica <- struct{}{}
			<-releaseProbe
			return fakeNetErr{}
		}
		primaryCalls.Add(1)
		return nil
	}

	probeDone := make(chan error, 1)
	go func() { probeDone <- d.Read(context.Background(), fn) }()
	<-inReplica

	require.NoError(t, d.Read(context.Background(), fn))
	require.Equal(t, int32(1), replicaCalls.Load(), "半开窗口只放一个探测，其余并发不得再碰副本")
	require.Equal(t, int32(1), primaryCalls.Load())

	unblock()
	require.NoError(t, <-probeDone, "探测失败 → 探测者回落主库成功")
	require.Equal(t, int32(1), replicaCalls.Load())
	require.Equal(t, int32(2), primaryCalls.Load(), "探测者在主库重放整个 fn（契约见 Read 注释）")
	require.False(t, d.breaker.Allow(), "探测失败才 re-Trip（PG2①）")
}

func TestReadCtxErrNoTripNoReplay_UTPG11(t *testing.T) {
	base := time.Unix(1780000000, 0)
	now := base
	d := &DB{primary: &pgxpool.Pool{}, breaker: breaker{openFor: time.Minute, now: func() time.Time { return now }}}
	d.replica.Store(&pgxpool.Pool{})
	d.breaker.Trip()
	now = now.Add(time.Minute)

	for _, ctxErr := range []error{context.Canceled, context.DeadlineExceeded} {
		calls := 0
		err := d.Read(context.Background(), func(_ context.Context, q DBTX) error {
			calls++
			return fmt.Errorf("query aborted: %w", ctxErr)
		})
		require.ErrorIs(t, err, ctxErr, "调用方 ctx 错误原样返回")
		require.Equal(t, 1, calls, "ctx 错误不得在主库重放 fn（同一 ctx 重放必然同样失败）")

		require.True(t, d.breaker.Allow(), "ctx 取消不得 Trip；本 Allow 即下一个探测者")
		d.breaker.release()
	}
}

func TestReadNonTransientClosesNoReplay_UTPG12(t *testing.T) {
	base := time.Unix(1780000000, 0)
	now := base
	d := &DB{primary: &pgxpool.Pool{}, breaker: breaker{openFor: time.Minute, now: func() time.Time { return now }}}
	d.replica.Store(&pgxpool.Pool{})
	d.breaker.Trip()
	now = now.Add(time.Minute)

	sqlErr := errors.New("42601 syntax error")
	calls := 0
	err := d.Read(context.Background(), func(_ context.Context, q DBTX) error {
		calls++
		return sqlErr
	})
	require.ErrorIs(t, err, sqlErr)
	require.Equal(t, 1, calls, "非连接类错误不重放（主库上同样失败，重放无意义）")
	require.True(t, d.breaker.Allow())
	require.True(t, d.breaker.Allow(), "连续两次放行 = 已关闭（半开时第二次会被保留位拦下）")
}

func TestReplicaRetryTakesOver_UTPG13(t *testing.T) {
	oldEvery := replicaRetryEvery
	replicaRetryEvery = 5 * time.Millisecond
	defer func() { replicaRetryEvery = oldEvery }()

	sink := &logSink{}
	oldDefault := slog.Default()
	slog.SetDefault(slog.New(sink))
	defer slog.SetDefault(oldDefault)

	marker := &pgxpool.Pool{}
	var attempts atomic.Int32
	d := &DB{breaker: newBreaker()}
	d.replicaDial = func(context.Context, string, Options) (*pgxpool.Pool, error) {
		if attempts.Add(1) <= 2 {
			return nil, errors.New("replica still down")
		}
		return marker, nil
	}

	off := false
	startReplicaRetry(d, Options{ReplicaDSN: "fake://unused-by-fake-dial", SelfHeal: &off})

	require.Eventually(t, func() bool { return d.replica.Load() == marker },
		3*time.Second, 2*time.Millisecond, "重试成功后接管读流量（replica 换入）")
	require.True(t, sink.contains("pg: replica retry connect failed, still primary-only"),
		"重试失败须留 Warn 信号, got %v", sink.snapshot())
	require.True(t, sink.contains("pg: replica connected after retry, taking over read traffic"),
		"接管成功须留 Info 信号, got %v", sink.snapshot())
}

func TestReplicaRetryStopsOnStop_UTPG14(t *testing.T) {
	oldEvery := replicaRetryEvery
	replicaRetryEvery = 5 * time.Millisecond
	defer func() { replicaRetryEvery = oldEvery }()

	var attempts atomic.Int32
	d := &DB{breaker: newBreaker()}
	d.replicaDial = func(context.Context, string, Options) (*pgxpool.Pool, error) {
		attempts.Add(1)
		return nil, errors.New("down")
	}

	off := false
	startReplicaRetry(d, Options{SelfHeal: &off})
	require.Eventually(t, func() bool { return attempts.Load() >= 2 },
		3*time.Second, 2*time.Millisecond, "停机前重试应在跑")

	d.stopReplicaRetry()
	d.stopReplicaRetry()
	time.Sleep(30 * time.Millisecond)
	frozen := attempts.Load()
	time.Sleep(60 * time.Millisecond)
	require.Equal(t, frozen, attempts.Load(), "停机口关闭后不再重拨")
}

func TestReplicaWatchdogOnRetryTakeover_UTPG15(t *testing.T) {
	oldEvery := replicaRetryEvery
	replicaRetryEvery = 5 * time.Millisecond
	defer func() { replicaRetryEvery = oldEvery }()

	var mu sync.Mutex
	watched := []*pgxpool.Pool{}
	oldStart := watchdogStart
	watchdogStart = func(p *pgxpool.Pool, _ bool) {
		mu.Lock()
		watched = append(watched, p)
		mu.Unlock()
	}
	defer func() { watchdogStart = oldStart }()

	marker := &pgxpool.Pool{}
	d := &DB{breaker: newBreaker()}
	d.replicaDial = func(context.Context, string, Options) (*pgxpool.Pool, error) {
		return marker, nil
	}
	startReplicaRetry(d, Options{})

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(watched) == 1 && watched[0] == marker
	}, 3*time.Second, 2*time.Millisecond, "重试接管的副本池必须挂看门狗（对齐主池）")

	off := false
	marker2 := &pgxpool.Pool{}
	d2 := &DB{breaker: newBreaker()}
	d2.replicaDial = func(context.Context, string, Options) (*pgxpool.Pool, error) {
		return marker2, nil
	}
	startReplicaRetry(d2, Options{SelfHeal: &off})
	require.Eventually(t, func() bool { return d2.replica.Load() == marker2 },
		3*time.Second, 2*time.Millisecond, "SelfHeal=false 不影响接管本身")
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, watched, 1, "SelfHeal=false 的副本池不得挂看门狗")
}

func TestPoolConfigPoolSizing_UTPG16(t *testing.T) {
	cfg, err := poolConfig("postgres://u:p@127.0.0.1:1/db?sslmode=disable", Options{MaxConns: 7, MinConns: 2})
	require.NoError(t, err)
	require.Equal(t, int32(7), cfg.MaxConns, "MaxConns 应透传 pgxpool.Config")
	require.Equal(t, int32(2), cfg.MinConns, "MinConns 应透传 pgxpool.Config")

	cfg, err = poolConfig("postgres://u:p@127.0.0.1:1/db?sslmode=disable&pool_max_conns=9&pool_min_conns=3", Options{})
	require.NoError(t, err)
	require.Equal(t, int32(9), cfg.MaxConns, "零值 Options 不得覆盖 DSN 的 pool_max_conns")
	require.Equal(t, int32(3), cfg.MinConns, "零值 Options 不得覆盖 DSN 的 pool_min_conns")

	base, err := pgxpool.ParseConfig("postgres://u:p@127.0.0.1:1/db?sslmode=disable")
	require.NoError(t, err)
	cfg, err = poolConfig("postgres://u:p@127.0.0.1:1/db?sslmode=disable", Options{})
	require.NoError(t, err)
	require.Equal(t, base.MaxConns, cfg.MaxConns, "零值 = 库默认")
	require.Equal(t, base.MinConns, cfg.MinConns, "零值 = 库默认")
}
