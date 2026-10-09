package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/haozing/ploykit/platform/egressx"
	"github.com/haozing/ploykit/webhooks"
)

type hookCall struct {
	workspaceID    string
	subscriptionID string
	deliveryID     string
	eventType      string
	reason         string
}

func boolPtr(b bool) *bool { return &b }

func TestOnDeliveryFailedHook_B7(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		url        string
		allowPriv  *bool
		attempts   int
		withHook   bool
		hookErr    error
		wantFired  bool
		wantDead   bool
		wantReason string
	}{
		{

			name: "重试耗尽(500, attempts=6) → 触发且参数正确", status: 500,
			attempts: 6, withHook: true, wantFired: true, wantDead: true, wantReason: "HTTP 500",
		},
		{
			name: "非终态重试(500, attempts=1) → 不触发", status: 500,
			attempts: 1, withHook: true, wantFired: false, wantDead: false,
		},
		{
			name: "投递成功(200) → 不触发", status: 200,
			attempts: 6, withHook: true, wantFired: false,
		},
		{
			name:      "目标拒绝直接终态化 → 触发",
			url:       "http://127.0.0.1:1/hook",
			allowPriv: boolPtr(false),
			attempts:  0, withHook: true, wantFired: true, wantDead: true, wantReason: "target rejected",
		},
		{
			name: "钩子报错 → 不影响死信落库(Observational)", status: 500,
			attempts: 6, withHook: true, hookErr: errors.New("hook boom"),
			wantFired: true, wantDead: true, wantReason: "HTTP 500",
		},
		{
			name: "nil 钩子 → 无操作不 panic", status: 500,
			attempts: 6, withHook: false, wantFired: false, wantDead: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			url := c.url
			if url == "" {
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(c.status)
				}))
				defer srv.Close()
				url = srv.URL
			}

			var calls []hookCall
			repo := &deliverRepo{fakeRepo: newFakeRepo()}
			svc := newDeliverSvc(repo, NewEventCatalog())
			if c.allowPriv != nil && !*c.allowPriv {

				strict, err := egressx.NewHTTPClient(egressx.Opts{})
				if err != nil {
					t.Fatalf("strict egress client: %v", err)
				}
				svc = svc.WithHTTPClient(strict)
			}
			if c.withHook {
				hookErr := c.hookErr
				svc = svc.WithHooks(webhooks.WebhookHooks{
					OnDeliveryFailed: func(_ context.Context, ws, sub, dlv, et, reason string) error {
						calls = append(calls, hookCall{ws, sub, dlv, et, reason})
						return hookErr
					},
				})
			}
			svc.deliverOne(context.Background(), PendingDelivery{
				DeliveryID: "dlv-9", SubscriptionID: "sub-9", WorkspaceID: fakeWS,
				URL: url, Secret: "whk_s", EventID: "evt-9",
				EventType: "task.created", Payload: []byte(`{}`), Attempts: c.attempts,
			})

			if c.wantFired {
				if len(calls) != 1 {
					t.Fatalf("OnDeliveryFailed 应触发一次, got %d", len(calls))
				}
				got := calls[0]
				if got.workspaceID != fakeWS || got.subscriptionID != "sub-9" ||
					got.deliveryID != "dlv-9" || got.eventType != "task.created" {
					t.Errorf("钩子参数: %+v", got)
				}
				if !strings.Contains(got.reason, c.wantReason) {
					t.Errorf("reason 应含 %q: %q", c.wantReason, got.reason)
				}
			} else if len(calls) != 0 {
				t.Errorf("OnDeliveryFailed 不应触发, got %+v", calls)
			}

			if c.wantDead {
				if len(repo.retries) != 1 || !repo.retries[0].dead {
					t.Errorf("应落 dead 死信: %+v", repo.retries)
				}
			} else if c.status == 500 && len(repo.retries) != 1 {
				t.Errorf("非终态重试应落 pending 重试: %+v", repo.retries)
			}
		})
	}
}

func TestOnSubscriptionDisabledHook_B7(t *testing.T) {
	cases := []struct {
		name      string
		active    bool
		subExists bool
		withHook  bool
		hookErr   error
		wantFired bool
		wantErr   bool
	}{
		{name: "停用 → 触发且参数正确", active: false, subExists: true, withHook: true, wantFired: true},
		{name: "恢复 → 不触发", active: true, subExists: true, withHook: true, wantFired: false},
		{name: "订阅不存在(repo 报错) → 不触发且错误上抛", active: false, subExists: false, withHook: true, wantErr: true},
		{name: "钩子报错 → 停用结果不受影响(Observational)", active: false, subExists: true, withHook: true, hookErr: errors.New("hook boom")},
		{name: "nil 钩子 → 无操作不 panic", active: false, subExists: true, withHook: false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var calls [][2]string
			repo := newFakeRepo()
			if c.subExists {
				repo.subs["sub-1"] = Subscription{ID: "sub-1", WorkspaceID: fakeWS, IsActive: true}
			}
			svc := newTestService(repo)
			if c.withHook {
				hookErr := c.hookErr
				svc = svc.WithHooks(webhooks.WebhookHooks{
					OnSubscriptionDisabled: func(_ context.Context, ws, sub string) error {
						calls = append(calls, [2]string{ws, sub})
						return hookErr
					},
				})
			}

			err := svc.SetSubscriptionActive(context.Background(), fakeWS, "sub-1", c.active)
			if c.wantErr {
				if !errors.Is(err, ErrNotFound) {
					t.Fatalf("应上抛 ErrNotFound, got %v", err)
				}
			} else if err != nil {
				t.Fatalf("SetSubscriptionActive: %v", err)
			}

			if c.wantFired || (c.hookErr != nil) {
				if len(calls) != 1 {
					t.Fatalf("OnSubscriptionDisabled 应触发一次, got %d", len(calls))
				}
				if calls[0] != [2]string{fakeWS, "sub-1"} {
					t.Errorf("钩子参数: %v", calls[0])
				}
			} else if len(calls) != 0 {
				t.Errorf("OnSubscriptionDisabled 不应触发, got %v", calls)
			}

			if c.subExists && repo.setTo["sub-1"] != c.active {
				t.Errorf("落库态应等于目标态 %v, got %v", c.active, repo.setTo["sub-1"])
			}
		})
	}
}
