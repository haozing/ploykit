package app

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

type fakeRepo struct {
	Repo
	subs   map[string]Subscription
	pinged []string
	setTo  map[string]bool
	redelv map[string]Delivery

	rotateSub, rotateNewSealed string
	rotateOldExpiry, rotateNow time.Time
	rotateErr                  error

	firstFailure    map[string]*time.Time
	firstFailureErr error
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		subs:         map[string]Subscription{},
		setTo:        map[string]bool{},
		redelv:       map[string]Delivery{},
		firstFailure: map[string]*time.Time{},
	}
}

const fakeWS = "ws-1"

func (f *fakeRepo) GetSubscription(_ context.Context, workspaceID, id string) (Subscription, bool, error) {
	s, ok := f.subs[id]
	if !ok || workspaceID != fakeWS {
		return Subscription{}, false, nil
	}
	return s, true, nil
}

func (f *fakeRepo) EnqueuePing(_ context.Context, workspaceID, subscriptionID string) error {
	if _, ok := f.subs[subscriptionID]; !ok || workspaceID != fakeWS {
		return ErrNotFound
	}
	f.pinged = append(f.pinged, subscriptionID)
	return nil
}

func (f *fakeRepo) SetSubscriptionActive(_ context.Context, workspaceID, id string, active bool, _ time.Time) error {
	if _, ok := f.subs[id]; !ok || workspaceID != fakeWS {
		return ErrNotFound
	}
	f.setTo[id] = active
	return nil
}

func (f *fakeRepo) Redeliver(_ context.Context, workspaceID, deliveryID string) (Delivery, error) {
	d, ok := f.redelv[deliveryID]
	if !ok || workspaceID != fakeWS {
		return Delivery{}, ErrNotFound
	}
	return d, nil
}

func (f *fakeRepo) RotateSecret(_ context.Context, workspaceID, subscriptionID, newSealed string, oldExpiry, now time.Time) error {
	if f.rotateErr != nil {
		return f.rotateErr
	}
	if _, ok := f.subs[subscriptionID]; !ok || workspaceID != fakeWS {
		return ErrNotFound
	}
	f.rotateSub, f.rotateNewSealed = subscriptionID, newSealed
	f.rotateOldExpiry, f.rotateNow = oldExpiry, now
	return nil
}

func (f *fakeRepo) FirstFailureAt(_ context.Context, subscriptionID string) (*time.Time, error) {
	if f.firstFailureErr != nil {
		return nil, f.firstFailureErr
	}
	return f.firstFailure[subscriptionID], nil
}

func newTestService(repo Repo) *WebhookService {
	return NewWebhookService(repo, NewEventCatalog(), nil, func() time.Time {
		return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	})
}

func TestServicePing(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	repo.subs["sub-1"] = Subscription{ID: "sub-1", WorkspaceID: fakeWS, IsActive: true}
	svc := newTestService(repo)

	if err := svc.Ping(ctx, fakeWS, "sub-1"); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if len(repo.pinged) != 1 || repo.pinged[0] != "sub-1" {
		t.Errorf("EnqueuePing 应被调用一次, got %v", repo.pinged)
	}

	if err := svc.Ping(ctx, fakeWS, "sub-x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("未知订阅应返回 ErrNotFound, got %v", err)
	}
	if err := svc.Ping(ctx, "ws-other", "sub-1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("跨工作区应返回 ErrNotFound, got %v", err)
	}
	if len(repo.pinged) != 1 {
		t.Errorf("失败的 Ping 不应入队, got %v", repo.pinged)
	}
}

func TestServicePing_PausedSubscription_Conflict_WH4(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	repo.subs["sub-p"] = Subscription{ID: "sub-p", WorkspaceID: fakeWS, IsActive: false}
	svc := newTestService(repo)

	err := svc.Ping(ctx, fakeWS, "sub-p")
	if err == nil {
		t.Fatal("暂停订阅的 Ping 必须报错")
	}
	var we *webx.Error
	if !errors.As(err, &we) || we.Status != http.StatusConflict || we.Code != webx.CodeConflict {
		t.Fatalf("应为 409 E_CONFLICT, got %+v", err)
	}
	if len(repo.pinged) != 0 {
		t.Errorf("暂停订阅不应入队 ping, got %v", repo.pinged)
	}
}

func TestServiceRedeliver(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	repo.redelv["dlv-1"] = Delivery{
		ID: "dlv-new", SubscriptionID: "sub-1",
		EventID: "evt-1.r1735689600000000000", EventType: "task.created",
		Status: StatusPending, Attempts: 0,
	}
	svc := newTestService(repo)

	got, err := svc.Redeliver(ctx, fakeWS, "dlv-1")
	if err != nil {
		t.Fatalf("Redeliver: %v", err)
	}
	if got.ID != "dlv-new" || got.Status != StatusPending {
		t.Errorf("应透传 repo 返回的新投递行, got %+v", got)
	}
	if _, err := svc.Redeliver(ctx, fakeWS, "dlv-x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("未知投递应返回 ErrNotFound, got %v", err)
	}
}

func TestServiceSetSubscriptionActive(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	repo.subs["sub-1"] = Subscription{ID: "sub-1", WorkspaceID: fakeWS}
	svc := newTestService(repo)

	if err := svc.SetSubscriptionActive(ctx, fakeWS, "sub-1", false); err != nil {
		t.Fatalf("SetSubscriptionActive: %v", err)
	}
	if repo.setTo["sub-1"] != false {
		t.Errorf("暂停未落库, got %v", repo.setTo)
	}
	if err := svc.SetSubscriptionActive(ctx, "ws-other", "sub-1", true); !errors.Is(err, ErrNotFound) {
		t.Errorf("跨工作区应返回 ErrNotFound, got %v", err)
	}
}

func TestSignVerify(t *testing.T) {
	secret := "whk_test"
	ts := time.Unix(1700000000, 0)
	body := []byte(`{"hello":"world"}`)

	sig := Sign(secret, ts, body)
	if sig == "" {
		t.Fatal("签名不应为空")
	}
	if len(sig) != 71 {
		t.Errorf("签名长度 %d, want 71", len(sig))
	}
	if !VerifySign(secret, ts, body, sig) {
		t.Error("正确签名应验证通过")
	}

	if VerifySign("whk_other", ts, body, sig) {
		t.Error("密钥不同应拒绝")
	}
	if VerifySign(secret, ts.Add(time.Second), body, sig) {
		t.Error("时间戳不同应拒绝")
	}
	if VerifySign(secret, ts, []byte(`{"hello":"world!"}`), sig) {
		t.Error("载荷被篡改应拒绝")
	}
	if VerifySign(secret, ts, body, "sha256="+string(make([]byte, 64))) {
		t.Error("全零签名应拒绝")
	}
}

func TestMintSecret(t *testing.T) {
	a, err := MintSecret()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := MintSecret()
	if len(a) != 68 {
		t.Errorf("secret 长度 %d, want 68", len(a))
	}
	if a == b {
		t.Error("两次生成不应相同")
	}
}

func TestVerifySignWithWindow_WH8(t *testing.T) {
	secret := "whk_test"
	ts := time.Unix(1700000000, 0)
	body := []byte(`{"hello":"world"}`)
	sig := Sign(secret, ts, body)
	now := ts.Add(2 * time.Minute)

	if !VerifySignWithWindow(secret, ts, body, sig, 5*time.Minute, now) {
		t.Error("窗口内的有效签名应通过")
	}
	if VerifySignWithWindow(secret, ts, body, sig, 5*time.Minute, ts.Add(6*time.Minute)) {
		t.Error("窗口外的有效签名必须拒绝（重放）")
	}
	if VerifySignWithWindow(secret, ts, body, sig, 5*time.Minute, ts.Add(-6*time.Minute)) {
		t.Error("未来方向的窗口外同样拒绝（时钟偏移上限）")
	}
	if VerifySignWithWindow("whk_other", ts, body, sig, 5*time.Minute, now) {
		t.Error("密钥不同应拒绝（先窗口后验签，均不通过）")
	}
}

func TestEventCatalog(t *testing.T) {
	c := NewEventCatalog()
	if c.Has("task.created") {
		t.Error("空目录不应包含事件")
	}
	c.Register("task.created", "任务创建")
	c.Register("task.created", "任务创建(重复注册覆盖)")
	if !c.Has("task.created") {
		t.Error("注册后应包含")
	}
	if c.Has("task.completed") {
		t.Error("未注册事件不应存在")
	}
	l := c.List()
	if len(l) != 1 || l["task.created"] != "任务创建(重复注册覆盖)" {
		t.Errorf("List 应返回覆盖后的唯一条目, got %v", l)
	}
}

func TestRetryBackoff(t *testing.T) {
	want := []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 6 * time.Hour}
	if len(RetryBackoff) != len(want) {
		t.Fatalf("退避表长度 %d, want %d", len(RetryBackoff), len(want))
	}
	for i, d := range want {
		if RetryBackoff[i] != d {
			t.Errorf("RetryBackoff[%d]=%v want %v", i, RetryBackoff[i], d)
		}
	}
}
