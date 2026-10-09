package app

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/egressx"
	"github.com/haozing/ploykit/platform/webx"
)

type deliverRepo struct {
	*fakeRepo
	created      []Subscription
	createdSec   string
	emitted      []OutboundEvent
	emitCount    int
	queue        []PendingDelivery
	claimErr     error
	delivered    []markDelivered
	retries      []markRetry
	listedLimit  []int
	markRetryErr error

	markDeliveredErr error
}

type markDelivered struct {
	id         string
	statusCode int
	at         time.Time
}

type markRetry struct {
	id         string
	statusCode int
	errMsg     string
	nextAt     time.Time
	dead       bool
}

func (d *deliverRepo) CreateSubscription(_ context.Context, sub Subscription, secret string) (Subscription, error) {
	sub.ID = "sub-new"
	d.created = append(d.created, sub)
	d.createdSec = secret
	return sub, nil
}

func (d *deliverRepo) ListSubscriptions(_ context.Context, _ string) ([]Subscription, error) {
	return nil, nil
}

func (d *deliverRepo) DeleteSubscription(_ context.Context, _, _ string) error { return nil }

func (d *deliverRepo) EmitForEvent(_ context.Context, _ string, e OutboundEvent) (int, error) {
	d.emitted = append(d.emitted, e)
	d.emitCount++
	return 3, nil
}

func (d *deliverRepo) ClaimPending(_ context.Context, _ int) ([]PendingDelivery, error) {
	if d.claimErr != nil {
		return nil, d.claimErr
	}
	return d.queue, nil
}

func (d *deliverRepo) MarkDelivered(_ context.Context, id string, statusCode int, now time.Time) error {
	d.delivered = append(d.delivered, markDelivered{id, statusCode, now})
	return d.markDeliveredErr
}

func (d *deliverRepo) MarkRetry(_ context.Context, id string, statusCode int, errMsg string, nextAt time.Time, dead bool) error {
	if d.markRetryErr != nil {
		return d.markRetryErr
	}
	d.retries = append(d.retries, markRetry{id, statusCode, errMsg, nextAt, dead})
	return nil
}

func (d *deliverRepo) ListDeliveries(_ context.Context, _ string, limit int) ([]Delivery, error) {
	d.listedLimit = append(d.listedLimit, limit)
	return []Delivery{{ID: "d1"}}, nil
}

func newDeliverSvc(repo *deliverRepo, catalog *EventCatalog) *WebhookService {
	svc := NewWebhookService(repo, catalog, nil, func() time.Time {
		return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	})

	client, err := egressx.NewHTTPClient(egressx.Opts{AllowCIDRs: []string{"127.0.0.0/8"}})
	if err != nil {
		panic(err)
	}
	return svc.WithHTTPClient(client)
}

func TestCreateSubscription_UTWH03(t *testing.T) {
	ctx := context.Background()
	catalog := NewEventCatalog()
	catalog.Register("task.created", "任务创建")
	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newDeliverSvc(repo, catalog).WithSecrets(&fakeSecrets{})

	_, _, err := svc.CreateSubscription(ctx, fakeWS, "https://8.8.8.8/hook", "d", []string{"nope.event"})
	if err == nil || !strings.Contains(err.Error(), "unknown event type") {
		t.Fatalf("未注册类型应报 unknown event type, got %v", err)
	}
	if len(repo.created) != 0 {
		t.Error("失败路径不应写仓储")
	}

	sub, secret, err := svc.CreateSubscription(ctx, fakeWS, "https://8.8.8.8/hook", "d", []string{"task.created"})
	if err != nil {
		t.Fatalf("ok path: %v", err)
	}
	if !strings.HasPrefix(secret, "whk_") || len(secret) != 68 {
		t.Errorf("secret 格式: %q", secret)
	}
	if !sub.IsActive || len(sub.EventTypes) != 1 || sub.EventTypes[0] != "task.created" {
		t.Errorf("订阅字段: %+v", sub)
	}
	if sub.WorkspaceID != fakeWS || sub.ID != "sub-new" {
		t.Errorf("订阅归属: %+v", sub)
	}
}

func TestEmit_UTWH04(t *testing.T) {
	ctx := context.Background()
	catalog := NewEventCatalog()
	catalog.Register("task.created", "任务创建")
	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newDeliverSvc(repo, catalog)

	n, err := svc.Emit(ctx, fakeWS, OutboundEvent{ID: "e1", Type: "nope", Payload: map[string]any{}})
	if err == nil || !strings.Contains(err.Error(), "not registered") || n != 0 {
		t.Fatalf("未注册类型应拒绝: n=%d err=%v", n, err)
	}
	if len(repo.emitted) != 0 {
		t.Error("失败路径不应写投递行")
	}

	n, err = svc.Emit(ctx, fakeWS, OutboundEvent{ID: "e2", Type: "task.created"})
	if err != nil || n != 3 {
		t.Fatalf("ok path: n=%d err=%v", n, err)
	}
	if len(repo.emitted) != 1 || repo.emitted[0].ID != "e2" {
		t.Errorf("事件应透传仓储: %+v", repo.emitted)
	}
}

func TestListDeliveriesPassthrough_UTWH05(t *testing.T) {
	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newDeliverSvc(repo, NewEventCatalog())
	if _, err := svc.ListDeliveries(context.Background(), fakeWS, 7); err != nil {
		t.Fatalf("ListDeliveries: %v", err)
	}
	if len(repo.listedLimit) != 1 || repo.listedLimit[0] != 7 {
		t.Errorf("limit 应原样透传, got %v", repo.listedLimit)
	}
}

func TestDeliverOneSuccess_UTWH06(t *testing.T) {
	var gotBody []byte
	var gotSig, gotTS, gotEventID, gotDeliveryID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = readAll(r)
		gotSig = r.Header.Get("X-Signature")
		gotTS = r.Header.Get("X-Timestamp")
		gotEventID = r.Header.Get("X-Event-Id")
		gotDeliveryID = r.Header.Get("X-Delivery-Id")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newDeliverSvc(repo, NewEventCatalog())
	payload := []byte(`{"k":"v"}`)
	svc.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-1", SubscriptionID: "sub-1", URL: srv.URL,
		Secret: "whk_s", EventID: "evt-1", EventType: "task.created",
		Payload: payload, Attempts: 0,
	})

	if len(repo.delivered) != 1 {
		t.Fatalf("应 MarkDelivered 一次, got %+v / retries %+v", repo.delivered, repo.retries)
	}
	if repo.delivered[0].statusCode != 200 || repo.delivered[0].id != "dlv-1" {
		t.Errorf("MarkDelivered 参数: %+v", repo.delivered[0])
	}
	if string(gotBody) != string(payload) || gotEventID != "evt-1" || gotDeliveryID != "dlv-1" {
		t.Errorf("请求内容: body=%q evt=%q dlv=%q", gotBody, gotEventID, gotDeliveryID)
	}

	ts, err := time.Parse(time.RFC3339Nano, gotTS)
	if err != nil {
		t.Fatalf("X-Timestamp 解析: %v", err)
	}
	if !VerifySign("whk_s", ts, gotBody, gotSig) {
		t.Errorf("签名应可验证: sig=%q ts=%q", gotSig, gotTS)
	}
}

func readAll(r *http.Request) ([]byte, error) {
	buf := make([]byte, 0, r.ContentLength)
	tmp := make([]byte, 512)
	for {
		n, err := r.Body.Read(tmp)
		buf = append(buf, tmp[:n]...)
		if err != nil {
			break
		}
	}
	return buf, nil
}

func TestDeliverOneRetryMatrix_UTWH07_UTWH08_UTWH10_WH2(t *testing.T) {
	frozen := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name        string
		status      int
		attempts    int
		wantDead    bool
		wantBackoff time.Duration
	}{
		{"500 第 1 败 → 1m 档", 500, 1, false, time.Minute},
		{"500 第 2 败 → 5m 档", 500, 2, false, 5 * time.Minute},
		{"500 第 3 败 → 30m 档", 500, 3, false, 30 * time.Minute},
		{"500 第 4 败 → 2h 档", 500, 4, false, 2 * time.Hour},
		{"500 第 5 败 → 6h 档（末档首次生效）", 500, 5, false, 6 * time.Hour},
		{"500 第 6 败 → dead", 500, 6, true, 6 * time.Hour},
		{"attempts=0 防御下限 → 1m 档不死", 500, 0, false, time.Minute},
		{"302 属非 2xx → 重试", 302, 1, false, time.Minute},
		{"404 属非 2xx → 重试", 404, 3, false, 30 * time.Minute},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(c.status)
			}))
			defer srv.Close()

			repo := &deliverRepo{fakeRepo: newFakeRepo()}
			svc := newDeliverSvc(repo, NewEventCatalog())
			svc.deliverOne(context.Background(), PendingDelivery{
				DeliveryID: "dlv-r", URL: srv.URL, Secret: "whk_s",
				EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: c.attempts,
			})
			if len(repo.retries) != 1 || len(repo.delivered) != 0 {
				t.Fatalf("应 MarkRetry 一次: %+v / %+v", repo.retries, repo.delivered)
			}
			got := repo.retries[0]
			if got.id != "dlv-r" || got.statusCode != c.status || got.dead != c.wantDead {
				t.Errorf("MarkRetry 参数: %+v (want dead=%v status=%d)", got, c.wantDead, c.status)
			}
			if !got.nextAt.After(frozen) {
				t.Errorf("nextAt 应在未来: %v", got.nextAt)
			}

			lo := frozen.Add(time.Duration(float64(c.wantBackoff) * 0.8))
			hi := frozen.Add(time.Duration(float64(c.wantBackoff) * 1.2))
			if got.nextAt.Before(lo) || got.nextAt.After(hi) {
				t.Errorf("nextAt=%v 超出 %v ±20%% 区间 [%v, %v]", got.nextAt, c.wantBackoff, lo, hi)
			}
			if !strings.Contains(got.errMsg, "HTTP") {
				t.Errorf("errMsg 应含状态摘要: %q", got.errMsg)
			}
		})
	}
}

func TestDeliverOneNetworkError_UTWH09(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()

	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newDeliverSvc(repo, NewEventCatalog())
	svc.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-net", URL: url, Secret: "whk_s",
		EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: 3,
	})
	if len(repo.retries) != 1 {
		t.Fatalf("应 MarkRetry 一次, got %+v", repo.retries)
	}
	got := repo.retries[0]
	if got.statusCode != 0 || got.dead {
		t.Errorf("网络错误不应带状态码也不应置 dead: %+v", got)
	}
	if got.errMsg == "" {
		t.Error("errMsg 应携带错误摘要")
	}

	if got := repo.retries[0].nextAt.Sub(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)); got < 24*time.Minute || got > 36*time.Minute {
		t.Errorf("attempts=3（第 3 败）→ 30m ±20%% 退避, got %v", got)
	}
}

func TestDeliverPending_UTWH11(t *testing.T) {

	repo := &deliverRepo{fakeRepo: newFakeRepo(), claimErr: errors.New("db down")}
	svc := newDeliverSvc(repo, NewEventCatalog())
	svc.DeliverPending(context.Background(), 10)
	if len(repo.retries)+len(repo.delivered) != 0 {
		t.Errorf("claim 失败不应有后续动作: %+v %+v", repo.retries, repo.delivered)
	}

	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
	}))
	defer srv.Close()
	repo2 := &deliverRepo{fakeRepo: newFakeRepo(), queue: []PendingDelivery{
		{DeliveryID: "d1", URL: srv.URL, Secret: "sealed:v1:s", EventID: "e1", EventType: "t", Payload: []byte(`{}`)},
		{DeliveryID: "d2", URL: srv.URL, Secret: "sealed:v1:s", EventID: "e2", EventType: "t", Payload: []byte(`{}`)},
	}}
	svc2 := newDeliverSvc(repo2, NewEventCatalog()).WithSecrets(&fakeSecrets{})
	svc2.DeliverPending(context.Background(), 10)
	if hits.Load() != 2 || len(repo2.delivered) != 2 {
		t.Errorf("批投递: hits=%d delivered=%+v", hits.Load(), repo2.delivered)
	}
}

type fakeSecrets struct {
	sealed     []string
	failUnseal bool
}

func (f *fakeSecrets) Seal(plain string) (string, error) {
	f.sealed = append(f.sealed, plain)
	return "sealed:v1:" + plain, nil
}

func (f *fakeSecrets) Unseal(stored string) (string, error) {
	if !strings.HasPrefix(stored, "sealed:v1:") {
		return "", errors.New("plaintext refused: legacy plaintext support removed")
	}
	if f.failUnseal {
		return "", errors.New("decrypt failed: cipher message authentication failed")
	}
	return strings.TrimPrefix(stored, "sealed:v1:"), nil
}

func TestCreateSubscription_SealsSecretBeforePersist_WH1(t *testing.T) {
	ctx := context.Background()
	catalog := NewEventCatalog()
	catalog.Register("task.created", "任务创建")
	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	sec := &fakeSecrets{}
	svc := newDeliverSvc(repo, catalog).WithSecrets(sec)

	sub, secret, err := svc.CreateSubscription(ctx, fakeWS, "https://8.8.8.8/hook", "d", []string{"task.created"})
	if err != nil {
		t.Fatalf("ok path: %v", err)
	}
	if !strings.HasPrefix(repo.createdSec, "sealed:v1:whk_") {
		t.Errorf("落库 secret 应为 sealed 形态, got %q", repo.createdSec)
	}
	if strings.HasPrefix(secret, "sealed:v1:") || !strings.HasPrefix(secret, "whk_") {
		t.Errorf("返回给调用方的应是明文 secret（只此一次）, got %q", secret)
	}
	if len(sec.sealed) != 1 || sec.sealed[0] != secret {
		t.Errorf("Seal 应被调用一次且收到明文, got %v", sec.sealed)
	}
	if sub.ID != "sub-new" {
		t.Errorf("订阅应正常创建, got %+v", sub)
	}
}

func TestCreateSubscription_NoSealKey_RefusesPlaintext_WH1(t *testing.T) {
	ctx := context.Background()
	catalog := NewEventCatalog()
	catalog.Register("task.created", "任务创建")
	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newDeliverSvc(repo, catalog)

	_, _, err := svc.CreateSubscription(ctx, fakeWS, "https://8.8.8.8/hook", "d", []string{"task.created"})
	if err == nil {
		t.Fatal("未配 seal key 时必须拒新密写（杜绝静默明文落库）")
	}
	var we *webx.Error
	if !errors.As(err, &we) || we.Status != http.StatusInternalServerError || we.Code != "E_SEAL_KEY_MISSING" {
		t.Fatalf("应为 500 E_SEAL_KEY_MISSING, got %+v", err)
	}
	if len(repo.created) != 0 {
		t.Error("拒写路径不应触仓储")
	}
}

func TestDeliverPending_UnsealsAndSigns_WH1(t *testing.T) {
	t.Run("sealed 行先解密再签名", func(t *testing.T) {
		var gotSig, gotTS string
		var gotBody []byte
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotBody, _ = readAll(r)
			gotSig = r.Header.Get("X-Signature")
			gotTS = r.Header.Get("X-Timestamp")
		}))
		defer srv.Close()

		repo := &deliverRepo{fakeRepo: newFakeRepo(), queue: []PendingDelivery{{
			DeliveryID: "dlv-1", SubscriptionID: "sub-1", URL: srv.URL,
			Secret: "sealed:v1:whk_plain", EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: 1,
		}}}
		svc := newDeliverSvc(repo, NewEventCatalog()).WithSecrets(&fakeSecrets{})
		svc.DeliverPending(context.Background(), 10)

		if len(repo.delivered) != 1 || len(repo.retries) != 0 {
			t.Fatalf("应投递成功: delivered=%+v retries=%+v", repo.delivered, repo.retries)
		}
		ts, err := time.Parse(time.RFC3339Nano, gotTS)
		if err != nil {
			t.Fatalf("X-Timestamp 解析: %v", err)
		}
		if !VerifySign("whk_plain", ts, gotBody, gotSig) {
			t.Errorf("签名应可用明文 secret 验证: sig=%q", gotSig)
		}
	})

	t.Run("明文行拒绝投递（兼容明文读已移除）", func(t *testing.T) {
		repo := &deliverRepo{fakeRepo: newFakeRepo(), queue: []PendingDelivery{{
			DeliveryID: "dlv-1", SubscriptionID: "sub-1", URL: "https://e.example.com/hook",
			Secret: "whk_plaintext", EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: 1,
		}}}
		svc := newDeliverSvc(repo, NewEventCatalog()).WithSecrets(&fakeSecrets{})
		svc.DeliverPending(context.Background(), 10)

		if len(repo.retries) != 1 || len(repo.delivered) != 0 {
			t.Fatalf("明文行应 markRetry 一次: retries=%+v delivered=%+v", repo.retries, repo.delivered)
		}
		if !strings.Contains(repo.retries[0].errMsg, "secret unseal failed") {
			t.Errorf("errMsg 应注明 unseal 失败: %q", repo.retries[0].errMsg)
		}
	})
}

func TestDeliverPending_UnsealFailure_MarksRetry_WH1(t *testing.T) {
	repo := &deliverRepo{fakeRepo: newFakeRepo(), queue: []PendingDelivery{{
		DeliveryID: "dlv-1", SubscriptionID: "sub-1", URL: "https://e.example.com/hook",
		Secret: "sealed:v1:whk_lost", EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: 1,
	}}}
	svc := newDeliverSvc(repo, NewEventCatalog()).WithSecrets(&fakeSecrets{failUnseal: true})
	svc.DeliverPending(context.Background(), 10)

	if len(repo.retries) != 1 || len(repo.delivered) != 0 {
		t.Fatalf("解密失败应 markRetry 一次: retries=%+v delivered=%+v", repo.retries, repo.delivered)
	}
	got := repo.retries[0]
	if got.id != "dlv-1" || got.statusCode != 0 || got.dead {
		t.Errorf("MarkRetry 参数: %+v", got)
	}
	if !strings.Contains(got.errMsg, "secret unseal failed") {
		t.Errorf("errMsg 应注明 unseal 失败: %q", got.errMsg)
	}

	if got := repo.retries[0].nextAt.Sub(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)); got < 48*time.Second || got > 72*time.Second {
		t.Errorf("按退避档位推进 next_attempt_at（1m ±20%%）, got %v", got)
	}
}

func TestDeliverPending_MarkRetryErrorLogged_WH3(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	repo := &deliverRepo{fakeRepo: newFakeRepo(), markRetryErr: errors.New("db down")}
	svc := NewWebhookService(repo, NewEventCatalog(), log, func() time.Time {
		return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	})

	svc.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-x", SubscriptionID: "sub-1", URL: "notaurl",
		Secret: "s", EventID: "e", EventType: "t", Payload: []byte(`{}`), Attempts: 1,
	})
	if !strings.Contains(buf.String(), "mark-retry failed") {
		t.Errorf("MarkRetry 错误必须 slog.Error 留痕, log=%q", buf.String())
	}
}

func TestDeliverOne_MarkDeliveredErrorLogged_P2_14(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	repo := &deliverRepo{fakeRepo: newFakeRepo(), markDeliveredErr: errors.New("db down")}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client, err := egressx.NewHTTPClient(egressx.Opts{AllowCIDRs: []string{"127.0.0.0/8"}})
	if err != nil {
		t.Fatal(err)
	}
	svc := NewWebhookService(repo, NewEventCatalog(), log, func() time.Time {
		return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	}).WithHTTPClient(client)
	svc.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-ok", SubscriptionID: "sub-1", URL: srv.URL,
		Secret: "s", EventID: "e", EventType: "t", Payload: []byte(`{}`), Attempts: 1,
	})
	if !strings.Contains(buf.String(), "mark-delivered failed") {
		t.Errorf("MarkDelivered 错误必须 slog.Error 留痕, log=%q", buf.String())
	}
	if len(repo.delivered) != 1 {
		t.Errorf("落库尝试应发生一次: %+v", repo.delivered)
	}
}

func TestWithHTTPClient_EnforcesTimeout_P3_34(t *testing.T) {
	svc := NewWebhookService(newFakeRepo(), NewEventCatalog(), nil, func() time.Time {
		return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	})
	noTimeout := &http.Client{}
	svc = svc.WithHTTPClient(noTimeout)
	if svc.HTTPClient == noTimeout {
		t.Fatal("未设 Timeout 的 client 应被浅拷贝替换（WH10 强制）")
	}
	if got := svc.HTTPClient.Timeout; got != 10*time.Second {
		t.Fatalf("Timeout 应强制 10s, got %v", got)
	}
	if noTimeout.Timeout != 0 {
		t.Fatalf("调用方的 client 值不应被改动: %v", noTimeout.Timeout)
	}

	withTimeout := &http.Client{Timeout: 3 * time.Second}
	svc2 := NewWebhookService(newFakeRepo(), NewEventCatalog(), nil, func() time.Time {
		return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	}).WithHTTPClient(withTimeout)
	if svc2.HTTPClient != withTimeout || svc2.HTTPClient.Timeout != 3*time.Second {
		t.Fatalf("自带 Timeout 的 client 应原样采用: %+v", svc2.HTTPClient)
	}
}
