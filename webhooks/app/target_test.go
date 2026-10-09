package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/egressx"
	"github.com/haozing/ploykit/platform/webx"
)

var frozenClock = func() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) }

func newTargetSvc(t *testing.T, allow bool) *WebhookService {
	t.Helper()
	if allow {
		t.Setenv(EnvAllowPrivateTarget, "1")
	} else {
		t.Setenv(EnvAllowPrivateTarget, "0")
	}
	return NewWebhookService(&deliverRepo{fakeRepo: newFakeRepo()}, NewEventCatalog(), nil, frozenClock)
}

func TestValidateTarget_SchemeWhitelist_SEC_V5(t *testing.T) {
	ctx := context.Background()
	svc := newTargetSvc(t, false)
	for _, url := range []string{
		"ftp://example.com/hook",
		"javascript:alert(1)",
		"file:///etc/passwd",
		"gopher://example.com",
		"/relative/path",
		"http://",

		"http://8.8.8.8/hook",
	} {
		if err := svc.validateTarget(ctx, url); err == nil {
			t.Errorf("url %q 应被拒绝", url)
		}
	}
	for _, url := range []string{"https://8.8.8.8/hook"} {
		if err := svc.validateTarget(ctx, url); err != nil {
			t.Errorf("url %q 应放行, got %v", url, err)
		}
	}

	if err := newTargetSvc(t, true).validateTarget(ctx, "ftp://10.0.0.1/hook"); err == nil {
		t.Error("allowPrivate 下 ftp:// 仍应被拒绝")
	}
}

func TestValidateTarget_PrivateFilter_SEC_V5(t *testing.T) {
	ctx := context.Background()
	strict := newTargetSvc(t, false)
	dev := newTargetSvc(t, true)

	rejected := []string{
		"http://localhost:8030/readyz",
		"http://sub.localhost/hook",
		"https://localhost/api",
		"http://127.0.0.1:8030/readyz",
		"http://127.8.8.8/hook",
		"http://10.0.0.5/hook",
		"http://172.16.0.9/hook",
		"http://192.168.1.20/hook",
		"http://169.254.169.254/latest/meta",
		"http://[::1]:9090/hook",
		"http://[fc00::1]/hook",
		"http://[fe80::1]/hook",
		"http://0.0.0.0/hook",
	}
	for _, url := range rejected {
		if err := strict.validateTarget(ctx, url); err == nil {
			t.Errorf("私网目标 %q 应被拒绝", url)
		}
	}

	allowed := []string{
		"http://localhost:8030/readyz",
		"http://127.0.0.1:8030/readyz",
		"http://127.8.8.8/hook",
		"http://10.0.0.5/hook",
		"http://172.16.0.9/hook",
		"http://192.168.1.20/hook",
		"http://169.254.169.254/latest/meta",
		"http://[::1]:9090/hook",
		"http://[fc00::1]/hook",
		"http://[fe80::1]/hook",
		"http://0.0.0.0/hook",
		"https://10.1.2.3/hook",
	}
	for _, url := range allowed {
		if err := dev.validateTarget(ctx, url); err != nil {
			t.Errorf("放行开关开启时 %q 应放行, got %v", url, err)
		}
	}
}

func TestValidateTarget_NilGuardFallsBackToBusinessChecks(t *testing.T) {
	ctx := context.Background()
	svc := NewWebhookService(&deliverRepo{fakeRepo: newFakeRepo()}, NewEventCatalog(), nil, frozenClock).
		WithHTTPClient(&http.Client{Timeout: time.Second})

	for _, url := range []string{"", "ftp://example.com/h", "/relative", "http://"} {
		if err := svc.validateTarget(ctx, url); err == nil {
			t.Errorf("nil guard 下 %q 仍应过业务校验（必填/格式/scheme）", url)
		}
	}

	if err := svc.validateTarget(ctx, "http://127.0.0.1:9999/hook"); err != nil {
		t.Errorf("nil guard 下私网判定应由注入方承担, got %v", err)
	}
}

func TestEnvAllowsPrivateTarget_SEC_V5(t *testing.T) {
	t.Setenv(EnvAllowPrivateTarget, "1")
	if !envAllowsPrivateTarget() {
		t.Error("1 应放行")
	}
	t.Setenv(EnvAllowPrivateTarget, "TRUE")
	if !envAllowsPrivateTarget() {
		t.Error("TRUE（大小写不敏感）应放行")
	}
	for _, v := range []string{"", "0", "false", "off", "yes please"} {
		t.Setenv(EnvAllowPrivateTarget, v)
		if envAllowsPrivateTarget() {
			t.Errorf("%q 不应放行", v)
		}
	}
}

func TestCreateSubscription_Validation400_API_FT2_5(t *testing.T) {
	ctx := context.Background()
	catalog := NewEventCatalog()
	catalog.Register("task.created", "任务创建")
	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	t.Setenv(EnvAllowPrivateTarget, "")
	svc := NewWebhookService(repo, catalog, nil, frozenClock)

	cases := []struct {
		name, url string
		events    []string
	}{
		{"未知事件名", "https://8.8.8.8/h", []string{"nope.event"}},
		{"ftp scheme", "ftp://example.com/h", []string{"task.created"}},
		{"javascript scheme", "javascript:alert(1)", []string{"task.created"}},
		{"私网目标", "http://127.0.0.1:8030/readyz", []string{"task.created"}},
	}
	for _, c := range cases {
		_, _, err := svc.CreateSubscription(ctx, fakeWS, c.url, "d", c.events)
		var we *webx.Error
		if !errors.As(err, &we) || we.Status != http.StatusBadRequest {
			t.Errorf("%s: 应 400 webx.Error, got %v", c.name, err)
		}
	}
	if len(repo.created) != 0 {
		t.Errorf("校验失败不应写仓储, got %+v", repo.created)
	}

	t.Setenv(EnvAllowPrivateTarget, "1")
	svc2 := NewWebhookService(repo, catalog, nil, frozenClock).WithSecrets(&fakeSecrets{})
	if _, _, err := svc2.CreateSubscription(ctx, fakeWS, "http://127.0.0.1:9999/hook", "d", []string{"task.created"}); err != nil {
		t.Errorf("放行开关下私网目标应可创建: %v", err)
	}
}

func TestDeliverOne_PrivateTargetRejected_SEC_V5(t *testing.T) {
	hitCh := make(chan struct{}, 8)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hitCh <- struct{}{}
		w.WriteHeader(200)
	}))
	defer srv.Close()

	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newTargetSvc(t, false)
	svc.repo = repo
	svc.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-priv", URL: srv.URL, Secret: "whk_s",
		EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: 0,
	})
	if len(repo.retries) != 1 || !repo.retries[0].dead {
		t.Fatalf("私网目标应 MarkRetry(dead=true), got %+v", repo.retries)
	}
	if !strings.Contains(repo.retries[0].errMsg, "target rejected") {
		t.Errorf("errMsg 应说明拒绝原因: %q", repo.retries[0].errMsg)
	}
	select {
	case <-hitCh:
		t.Fatal("开关关闭时不应发出出站请求")
	default:
	}

	repo2 := &deliverRepo{fakeRepo: newFakeRepo()}
	svc2 := newTargetSvc(t, true)
	svc2.repo = repo2
	svc2.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-ok", URL: srv.URL, Secret: "whk_s",
		EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: 0,
	})
	if len(repo2.delivered) != 1 {
		t.Fatalf("放行后应投递成功, delivered=%+v retries=%+v", repo2.delivered, repo2.retries)
	}
}

func TestConstructor_WiresEgressGuardByDefault(t *testing.T) {
	t.Setenv(EnvAllowPrivateTarget, "0")
	svc := NewWebhookService(&deliverRepo{fakeRepo: newFakeRepo()}, NewEventCatalog(), nil, frozenClock)
	if svc.HTTPClient == nil {
		t.Fatal("默认应注入 egressx 受控 client")
	}
	if svc.targetGuard == nil {
		t.Fatal("默认装配应能提取预检 Guard")
	}
	if g := egressx.GuardOf(svc.HTTPClient); g == nil {
		t.Fatal("GuardOf 应从默认 client 取回判定器")
	}
}
