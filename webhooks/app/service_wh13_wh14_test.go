package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/webhooks"
)

var frozen = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

func TestRotateSecret_WH13(t *testing.T) {
	ctx := context.Background()
	repo := newFakeRepo()
	repo.subs["sub-1"] = Subscription{ID: "sub-1", WorkspaceID: fakeWS, IsActive: true}
	sec := &fakeSecrets{}
	svc := newTestService(repo).WithSecrets(sec)

	secret, err := svc.RotateSecret(ctx, fakeWS, "sub-1")
	if err != nil {
		t.Fatalf("RotateSecret: %v", err)
	}
	if len(secret) != 68 || secret[:4] != "whk_" {
		t.Errorf("应返回全新明文钥（whk_ + 64 hex）, got %q", secret)
	}
	if repo.rotateSub != "sub-1" || repo.rotateNewSealed != "sealed:v1:"+secret {
		t.Errorf("repo 应收到 sealed 新钥: sub=%q sealed=%q", repo.rotateSub, repo.rotateNewSealed)
	}
	if !repo.rotateOldExpiry.Equal(frozen.Add(OldSecretTTL)) {
		t.Errorf("宽限终点 = 轮换时刻+24h, got %v want %v", repo.rotateOldExpiry, frozen.Add(OldSecretTTL))
	}
	if !repo.rotateNow.Equal(frozen) {
		t.Errorf("repo now 应为服务时钟 %v, got %v", frozen, repo.rotateNow)
	}

	repo2 := newFakeRepo()
	repo2.subs["sub-1"] = Subscription{ID: "sub-1", WorkspaceID: fakeWS}
	_, err = newTestService(repo2).RotateSecret(ctx, fakeWS, "sub-1")
	var we *webx.Error
	if !errors.As(err, &we) || we.Status != http.StatusInternalServerError || we.Code != "E_SEAL_KEY_MISSING" {
		t.Fatalf("None 形态应 500 E_SEAL_KEY_MISSING, got %+v", err)
	}
	if repo2.rotateNewSealed != "" {
		t.Error("拒写路径不应触仓储")
	}

	repo3 := newFakeRepo()
	repo3.subs["sub-1"] = Subscription{ID: "sub-1", WorkspaceID: fakeWS}
	_, err = newTestService(repo3).WithSecrets(&fakeSecrets{}).RotateSecret(ctx, "ws-other", "sub-1")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("跨工作区应 ErrNotFound, got %v", err)
	}
	_, err = newTestService(repo3).WithSecrets(&fakeSecrets{}).RotateSecret(ctx, fakeWS, "sub-x")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("未知订阅应 ErrNotFound, got %v", err)
	}
}

func TestDeliverOne_DualSignature_WH13(t *testing.T) {
	var gotSig, gotSigOld, gotTS string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = readAll(r)
		gotSig = r.Header.Get("X-Signature")
		gotSigOld = r.Header.Get("X-Signature-Old")
		gotTS = r.Header.Get("X-Timestamp")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	svc := newDeliverSvc(repo, NewEventCatalog())
	payload := []byte(`{"k":"v"}`)
	svc.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-1", URL: srv.URL,
		Secret: "whk_new", OldPlain: "whk_old",
		EventID: "evt-1", EventType: "t", Payload: payload,
	})

	ts, err := time.Parse(time.RFC3339Nano, gotTS)
	if err != nil {
		t.Fatalf("X-Timestamp 解析: %v", err)
	}
	if !VerifySign("whk_new", ts, gotBody, gotSig) {
		t.Errorf("X-Signature 应可用新钥验证: %q", gotSig)
	}
	if !VerifySign("whk_old", ts, gotBody, gotSigOld) {
		t.Errorf("X-Signature-Old 应可用旧钥验证: %q", gotSigOld)
	}

	if !VerifySignAny([]string{"whk_new", "whk_old"}, ts, gotBody, gotSig) ||
		!VerifySignAny([]string{"whk_new", "whk_old"}, ts, gotBody, gotSigOld) {
		t.Error("VerifySignAny 应接受任一签名头")
	}

	svc.deliverOne(context.Background(), PendingDelivery{
		DeliveryID: "dlv-2", URL: srv.URL,
		Secret: "whk_new", EventID: "evt-2", EventType: "t", Payload: payload,
	})
	if gotSigOld != "" {
		t.Errorf("无旧钥不应携带 X-Signature-Old, got %q", gotSigOld)
	}
}

func TestDeliverPending_OldSecretWindow_WH13(t *testing.T) {
	run := func(oldSealed string, expiry *time.Time, secrets Secrets) (string, string, time.Time, []byte) {
		var sig, sigOld, tsStr string
		var body []byte
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, _ = readAll(r)
			sig, sigOld, tsStr = r.Header.Get("X-Signature"), r.Header.Get("X-Signature-Old"), r.Header.Get("X-Timestamp")
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()
		repo := &deliverRepo{fakeRepo: newFakeRepo(), queue: []PendingDelivery{{
			DeliveryID: "dlv-1", SubscriptionID: "sub-1", URL: srv.URL,
			Secret: "sealed:v1:whk_new", OldSealed: oldSealed, OldExpiresAt: expiry,
			EventID: "evt", EventType: "t", Payload: []byte(`{}`), Attempts: 1,
		}}}
		svc := newDeliverSvc(repo, NewEventCatalog()).WithSecrets(secrets)
		svc.DeliverPending(context.Background(), 10)
		ts, _ := time.Parse(time.RFC3339Nano, tsStr)
		return sig, sigOld, ts, body
	}

	t.Run("宽限期内：双签名，旧钥可验", func(t *testing.T) {
		expiry := frozen.Add(12 * time.Hour)
		sig, sigOld, ts, body := run("sealed:v1:whk_old", &expiry, &fakeSecrets{})
		if !VerifySign("whk_new", ts, body, sig) {
			t.Errorf("新钥签名应可验: %q", sig)
		}
		if !VerifySign("whk_old", ts, body, sigOld) {
			t.Errorf("旧钥签名应可验（宽限期内双签名）: %q", sigOld)
		}
	})

	t.Run("过期：旧钥停签（无 X-Signature-Old），新钥照常", func(t *testing.T) {
		expiry := frozen.Add(-time.Hour)
		sig, sigOld, ts, body := run("sealed:v1:whk_old", &expiry, &fakeSecrets{})
		if !VerifySign("whk_new", ts, body, sig) {
			t.Errorf("新钥签名应可验: %q", sig)
		}
		if sigOld != "" {
			t.Errorf("过期旧钥不得签名, got X-Signature-Old=%q", sigOld)
		}
	})

	t.Run("旧钥解密失败：降级单签名（Best-effort）", func(t *testing.T) {
		expiry := frozen.Add(12 * time.Hour)

		sig, sigOld, ts, body := run("sealed:v1:whk_old:BROKEN", &expiry, splitSecrets{})
		if !VerifySign("whk_new", ts, body, sig) {
			t.Errorf("新钥签名应可验（旧钥失败不影响投递）: %q", sig)
		}
		if sigOld != "" {
			t.Errorf("旧钥解密失败不得携带签名头, got %q", sigOld)
		}
	})
}

type splitSecrets struct{}

func (splitSecrets) Seal(plain string) (string, error) { return "sealed:v1:" + plain, nil }

func (splitSecrets) Unseal(stored string) (string, error) {
	if strings.HasPrefix(stored, "sealed:v1:") && strings.HasSuffix(stored, ":BROKEN") {
		return "", errors.New("decrypt failed: cipher message authentication failed")
	}
	if !strings.HasPrefix(stored, "sealed:v1:") {
		return "", errors.New("plaintext refused: legacy plaintext support removed")
	}
	return strings.TrimPrefix(stored, "sealed:v1:"), nil
}

func TestVerifySignAny_WH13(t *testing.T) {
	secretA, secretB := "whk_a", "whk_b"
	ts := time.Unix(1700000000, 0)
	body := []byte(`{"hello":"world"}`)
	sigA := Sign(secretA, ts, body)

	if !VerifySignAny([]string{secretA, secretB}, ts, body, sigA) {
		t.Error("命中第一把应通过")
	}
	if !VerifySignAny([]string{secretB, secretA}, ts, body, sigA) {
		t.Error("命中第二把应通过（顺序无关）")
	}
	if !VerifySignAny([]string{"", secretA}, ts, body, sigA) {
		t.Error("空钥应跳过且不阻断后续候选")
	}
	if VerifySignAny([]string{secretB, "whk_c"}, ts, body, sigA) {
		t.Error("全候选不中应拒绝")
	}
	if VerifySignAny(nil, ts, body, sigA) {
		t.Error("空集合应拒绝")
	}
}

func TestAutoDisableOnDead_WH14(t *testing.T) {
	cases := []struct {
		name         string
		firstFailure *time.Time
		dead         bool
		wantDisabled bool
	}{
		{"dead + 窗满 5 天 → 禁用", timePtr(frozen.Add(-AutoDisableWindow)), true, true},
		{"dead + 窗超 5 天 → 禁用", timePtr(frozen.Add(-30 * 24 * time.Hour)), true, true},
		{"dead + 窗差一秒 → 不禁用", timePtr(frozen.Add(-AutoDisableWindow + time.Second)), true, false},
		{"dead + 无窗（期间曾成功）→ 不禁用", nil, true, false},
		{"非 dead 重试 + 窗满 → 不禁用（只在 dead 时检查）", timePtr(frozen.Add(-AutoDisableWindow)), false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var hookCalls int
			repo := &deliverRepo{fakeRepo: newFakeRepo()}
			repo.subs["sub-9"] = Subscription{ID: "sub-9", WorkspaceID: fakeWS, IsActive: true}
			if c.firstFailure != nil {
				repo.firstFailure["sub-9"] = c.firstFailure
			}
			svc := newDeliverSvc(repo, NewEventCatalog()).WithHooks(webhooks.WebhookHooks{
				OnSubscriptionDisabled: func(_ context.Context, ws, sub string) error {
					hookCalls++
					if ws != fakeWS || sub != "sub-9" {
						t.Errorf("钩子参数: ws=%q sub=%q", ws, sub)
					}
					return nil
				},
			})

			svc.markRetry(context.Background(), PendingDelivery{
				DeliveryID: "dlv-9", SubscriptionID: "sub-9", WorkspaceID: fakeWS,
			}, 500, "HTTP 500", frozen.Add(time.Minute), c.dead)

			_, called := repo.setTo["sub-9"]
			if called != c.wantDisabled {
				t.Errorf("wantDisabled=%v, got called=%v hookCalls=%d", c.wantDisabled, called, hookCalls)
			}
			if c.wantDisabled && hookCalls != 1 {
				t.Errorf("自动停用应经 OnSubscriptionDisabled 钩子路径触发一次, got %d", hookCalls)
			}
			if !c.wantDisabled && hookCalls != 0 {
				t.Errorf("不应触发停用钩子, got %d", hookCalls)
			}
		})
	}
}

func TestAutoDisable_ClearedBySuccess_WH14(t *testing.T) {
	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	repo.subs["sub-9"] = Subscription{ID: "sub-9", WorkspaceID: fakeWS, IsActive: true}
	svc := newDeliverSvc(repo, NewEventCatalog())

	repo.firstFailure["sub-9"] = timePtr(frozen.Add(-AutoDisableWindow))
	repo.firstFailure["sub-9"] = nil
	svc.markRetry(context.Background(), PendingDelivery{
		DeliveryID: "dlv-9", SubscriptionID: "sub-9", WorkspaceID: fakeWS,
	}, 500, "HTTP 500", frozen.Add(time.Minute), true)

	if _, disabled := repo.setTo["sub-9"]; disabled {
		t.Error("成功清窗后 dead 不应自动禁用")
	}
}

func TestAutoDisable_ReadFailureLogged_WH14(t *testing.T) {
	repo := &deliverRepo{fakeRepo: newFakeRepo()}
	repo.subs["sub-9"] = Subscription{ID: "sub-9", WorkspaceID: fakeWS, IsActive: true}
	repo.firstFailureErr = errors.New("db down")
	svc := newDeliverSvc(repo, NewEventCatalog())

	svc.markRetry(context.Background(), PendingDelivery{
		DeliveryID: "dlv-9", SubscriptionID: "sub-9", WorkspaceID: fakeWS,
	}, 500, "HTTP 500", frozen.Add(time.Minute), true)

	if len(repo.retries) != 1 || !repo.retries[0].dead {
		t.Fatalf("读失败不应影响死信落库: %+v", repo.retries)
	}
	if _, called := repo.setTo["sub-9"]; called {
		t.Error("读失败时不得盲目禁用")
	}
}

func timePtr(t time.Time) *time.Time { return &t }
