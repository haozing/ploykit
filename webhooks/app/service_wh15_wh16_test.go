package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDeliverOneAbortMessage_WH15(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		abortHdr   string
		attempts   int
		wantDead   bool
		wantErrMsg string
	}{
		{"500 无头 → 正常退避重试", 500, "", 1, false, "HTTP 500"},
		{"500 + abort → 立即 dead", 500, "abort-message", 1, true, "receiver requested abort"},
		{"410 + abort（端点永久下线典型场景）→ dead", 410, "abort-message", 3, true, "receiver requested abort"},
		{"400 无头 → 照常重试（第 3 败 30m 档）", 400, "", 3, false, "HTTP 400"},
		{"abort 头值不匹配（其他值）→ 不生效照常重试", 500, "keep-going", 1, false, "HTTP 500"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if c.abortHdr != "" {
					w.Header().Set(AbortHeader, c.abortHdr)
				}
				w.WriteHeader(c.status)
			}))
			defer srv.Close()

			repo := &deliverRepo{fakeRepo: newFakeRepo()}
			svc := newDeliverSvc(repo, NewEventCatalog())
			svc.deliverOne(context.Background(), PendingDelivery{
				DeliveryID: "dlv-abort", SubscriptionID: "sub-1", URL: srv.URL,
				Secret: "whk_s", EventID: "evt", EventType: "t",
				Payload: []byte(`{}`), Attempts: c.attempts,
			})

			if len(repo.retries) != 1 || len(repo.delivered) != 0 {
				t.Fatalf("非 2xx 应 MarkRetry 一次: retries=%+v delivered=%+v", repo.retries, repo.delivered)
			}
			got := repo.retries[0]
			if got.dead != c.wantDead {
				t.Errorf("dead = %v, want %v（errMsg=%q）", got.dead, c.wantDead, got.errMsg)
			}
			if !strings.Contains(got.errMsg, c.wantErrMsg) {
				t.Errorf("errMsg %q 应含 %q", got.errMsg, c.wantErrMsg)
			}
			if got.statusCode != c.status {
				t.Errorf("statusCode = %d, want %d", got.statusCode, c.status)
			}
			if c.wantDead && !got.nextAt.Equal(frozen) {
				t.Errorf("abort 置 dead 时 nextAt 无重试语义, got %v want %v", got.nextAt, frozen)
			}
		})
	}
}

func TestDeliverOneAbortHeaderOnSuccessIgnored_WH15(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(AbortHeader, AbortHeaderValue)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newDeliverSvc(repo, NewEventCatalog())
	svc.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-ok", URL: srv.URL, Secret: "whk_s",
		EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: 1,
	})
	if len(repo.delivered) != 1 || len(repo.retries) != 0 {
		t.Fatalf("2xx（即便带 abort 头）应 MarkDelivered: delivered=%+v retries=%+v", repo.delivered, repo.retries)
	}
}

func TestRetryPlanJitterBounds_WH16(t *testing.T) {
	cases := []struct {
		attempts int
		backoff  time.Duration
		wantDead bool
	}{
		{1, time.Minute, false},
		{2, 5 * time.Minute, false},
		{3, 30 * time.Minute, false},
		{4, 2 * time.Hour, false},
		{5, 6 * time.Hour, false},
		{6, 6 * time.Hour, true},
	}
	for _, c := range cases {
		t.Run(map[int]string{1: "第1败1m档", 2: "第2败5m档", 3: "第3败30m档", 4: "第4败2h档", 5: "第5败6h档", 6: "第6败dead"}[c.attempts], func(t *testing.T) {
			seen := map[time.Duration]bool{}
			for i := 0; i < 200; i++ {
				nextAt, dead := retryPlan(c.attempts, frozen)
				if dead != c.wantDead {
					t.Fatalf("dead = %v, want %v（jitter 不得改变死信判定）", dead, c.wantDead)
				}
				got := nextAt.Sub(frozen)
				lo, hi := time.Duration(float64(c.backoff)*0.8), time.Duration(float64(c.backoff)*1.2)
				if got < lo || got > hi {
					t.Fatalf("退避 %v 超出 ±20%% 区间: got %v, want [%v, %v]", c.backoff, got, lo, hi)
				}
				seen[got] = true
			}
			if len(seen) < 2 {
				t.Errorf("200 次采样应出现多个不同退避值（防惊群抖动生效中）, got %d 个", len(seen))
			}
		})
	}
}

func TestDeliverOneJitterBounds_WH16(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	const attempts = 2
	for i := 0; i < 20; i++ {
		repo := &deliverRepo{fakeRepo: newFakeRepo()}
		svc := newDeliverSvc(repo, NewEventCatalog())
		svc.deliverOne(context.Background(), PendingDelivery{
			DeliveryID: "dlv-j", URL: srv.URL, Secret: "whk_s",
			EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: attempts,
		})
		if len(repo.retries) != 1 {
			t.Fatalf("应 MarkRetry 一次: %+v", repo.retries)
		}
		got := repo.retries[0].nextAt.Sub(frozen)
		if got < 4*time.Minute || got > 6*time.Minute {
			t.Fatalf("5m 档 ±20%% 应在 [4m, 6m], got %v", got)
		}
	}
}
