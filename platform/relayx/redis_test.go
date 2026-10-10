package relayx

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/wswire"
)

func newTestRedisClient(t *testing.T) *redis.Client {
	t.Helper()
	raw := os.Getenv("TEST_REDIS_URL")
	if raw == "" {
		t.Skip("TEST_REDIS_URL not set; redis transport integration skipped")
	}
	opt, err := redis.ParseURL(raw)
	require.NoError(t, err)
	cli := redis.NewClient(opt)
	t.Cleanup(func() { _ = cli.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	require.NoError(t, cli.Ping(ctx).Err(), "redis at %s not reachable", raw)
	return cli
}

func TestRedisTransportDualRelayInterop(t *testing.T) {
	cli := newTestRedisClient(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	tp := NewRedisTransport(cli)
	selfA, selfB := ids.NewV7().String(), ids.NewV7().String()
	a := NewRelay(selfA, tp, nil)
	b := NewRelay(selfB, tp, nil)

	var ownA atomic.Int32
	var got []Envelope
	var mu sync.Mutex
	runDone := make(chan error, 2)
	go func() { runDone <- a.Run(ctx, func(Envelope) { ownA.Add(1) }) }()
	go func() {
		runDone <- b.Run(ctx, func(env Envelope) {
			mu.Lock()
			got = append(got, env)
			mu.Unlock()
		})
	}()

	require.Eventually(t, func() bool {
		n, err := cli.PubSubNumSub(ctx, Channel).Result()
		return err == nil && n[Channel] >= 2
	}, 5*time.Second, 50*time.Millisecond)

	require.NoError(t, tp.Publish(ctx, []byte("garbage bytes")))

	payload, _ := json.Marshal(map[string]string{"hello": "redis"})
	a.PublishOut(ctx, wswire.ScopeKey(wswire.ScopeUser, "u-redis"),
		wswire.Frame{Type: "task:completed", Payload: payload, EventID: "rx-1"})

	require.Eventually(t, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(got) == 1
	}, 5*time.Second, 50*time.Millisecond)

	mu.Lock()
	env := got[0]
	mu.Unlock()
	assert.Equal(t, selfA, env.Origin)
	assert.Equal(t, wswire.ScopeKey(wswire.ScopeUser, "u-redis"), env.Scope)
	assert.Equal(t, "task:completed", env.Frame.Type)
	assert.Equal(t, "rx-1", env.Frame.EventID)
	assert.JSONEq(t, `{"hello":"redis"}`, string(env.Frame.Payload))

	assert.Never(t, func() bool { return ownA.Load() > 0 },
		300*time.Millisecond, 20*time.Millisecond)

	cancel()
	for i := 0; i < 2; i++ {
		select {
		case err := <-runDone:
			require.NoError(t, err, "ctx cancel is a clean exit")
		case <-time.After(2 * time.Second):
			t.Fatal("Subscribe did not exit on ctx cancel")
		}
	}
}

func TestRedisTransportResubscribesForever(t *testing.T) {
	cli := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:1",
		DialTimeout: 50 * time.Millisecond,
		ReadTimeout: 50 * time.Millisecond,
	})
	t.Cleanup(func() { _ = cli.Close() })

	oldBase, oldMax := redisRetryBaseBackoff, redisRetryMaxBackoff
	redisRetryBaseBackoff, redisRetryMaxBackoff = 5*time.Millisecond, 20*time.Millisecond
	t.Cleanup(func() { redisRetryBaseBackoff, redisRetryMaxBackoff = oldBase, oldMax })

	tp := NewRedisTransport(cli)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- tp.Subscribe(ctx, func([]byte) {}) }()

	select {
	case err := <-done:
		t.Fatalf("Subscribe 不得自行退出（redis 故障=降级不退出），退出错误: %v", err)
	case <-time.After(600 * time.Millisecond):
	}

	cancel()
	select {
	case err := <-done:
		require.NoError(t, err, "ctx 取消是唯一正常退出路径且必须干净")
	case <-time.After(2 * time.Second):
		t.Fatal("ctx 取消后 Subscribe 未退出")
	}
}
