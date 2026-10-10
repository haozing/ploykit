package webx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeSessions struct {
	verifyErr error
	p         *Principal

	renewExp     time.Time
	renewed      bool
	renewErr     error
	renewCalled  int
	renewedCount int
}

func (f *fakeSessions) VerifySession(_ context.Context, _ string, _ time.Time) (*Principal, error) {
	return f.p, f.verifyErr
}
func (f *fakeSessions) CreateSession(_ context.Context, _ SessionCreate) (string, time.Time, error) {
	return "tok", time.Now().Add(time.Hour), nil
}
func (f *fakeSessions) RenewSession(_ context.Context, _ string, _ time.Time) (time.Time, bool, error) {
	f.renewCalled++
	if f.renewed {
		f.renewedCount++
	}
	return f.renewExp, f.renewed, f.renewErr
}
func (f *fakeSessions) RevokeSession(_ context.Context, _ string) error { return nil }

type fakePATs struct {
	resolveErr error
	p          *Principal
	called     bool
}

func (f *fakePATs) ResolvePAT(_ context.Context, _ string, _ time.Time) (*Principal, error) {
	f.called = true
	return f.p, f.resolveErr
}

func doAuth(t *testing.T, sessions SessionStore, pats PATLookup, req *http.Request) (*httptest.ResponseRecorder, bool) {
	t.Helper()
	return doAuthCfg(t, &AuthConfig{CookieName: "tk_auth", SessionTTL: time.Hour, Secure: false}, sessions, pats, req)
}

func doAuthCfg(t *testing.T, cfg *AuthConfig, sessions SessionStore, pats PATLookup, req *http.Request) (*httptest.ResponseRecorder, bool) {
	t.Helper()
	reached := false
	h := Authenticate(cfg, sessions, pats)(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { reached = true }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w, reached
}

func reqWithCookie(name, value string) *http.Request {
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(&http.Cookie{Name: name, Value: value})
	return r
}

func TestAuthenticate_SessionStoreError_Returns503(t *testing.T) {
	w, reached := doAuth(t, &fakeSessions{verifyErr: errors.New("db down")}, &fakePATs{}, reqWithCookie("tk_auth", "tok"))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
	if reached {
		t.Fatal("downstream handler must not run on auth backend failure")
	}
	if !strings.Contains(w.Body.String(), "E_UNAVAILABLE") {
		t.Fatalf("body = %s, want E_UNAVAILABLE envelope", w.Body.String())
	}
}

func TestAuthenticate_InvalidSession_AnonymousPassthrough(t *testing.T) {
	w, reached := doAuth(t, &fakeSessions{}, &fakePATs{}, reqWithCookie("tk_auth", "tok"))
	if w.Code != http.StatusOK || !reached {
		t.Fatalf("status = %d reached = %v, want 200 + passthrough", w.Code, reached)
	}
}

func TestAuthenticate_ValidSession_Reaches(t *testing.T) {
	w, reached := doAuth(t, &fakeSessions{p: &Principal{UserID: "u1"}}, &fakePATs{}, reqWithCookie("tk_auth", "tok"))
	if w.Code != http.StatusOK || !reached {
		t.Fatalf("status = %d reached = %v, want 200 + reached", w.Code, reached)
	}
}

func TestAuthenticate_PATResolveError_Returns503(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer tk_abc")
	w, reached := doAuth(t, &fakeSessions{}, &fakePATs{resolveErr: errors.New("db down")}, r)
	if w.Code != http.StatusServiceUnavailable || reached {
		t.Fatalf("status = %d reached = %v, want 503 + not reached", w.Code, reached)
	}
	if !strings.Contains(w.Body.String(), "E_UNAVAILABLE") {
		t.Fatalf("body = %s, want E_UNAVAILABLE envelope", w.Body.String())
	}
}

func TestAuthenticate_PATInvalid_Returns401(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer tk_abc")
	w, reached := doAuth(t, &fakeSessions{}, &fakePATs{}, r)
	if w.Code != http.StatusUnauthorized || reached {
		t.Fatalf("status = %d reached = %v, want 401 + not reached", w.Code, reached)
	}
}

type slidingStore struct {
	fakeSessions
	ttl  time.Duration
	exp  time.Time
	absE time.Time
	vnow time.Time
}

func (s *slidingStore) RenewSession(_ context.Context, _ string, _ time.Time) (time.Time, bool, error) {
	now := s.vnow
	if !s.exp.Before(now.Add(s.ttl / 2)) {
		return time.Time{}, false, nil
	}
	s.exp = now.Add(s.ttl)
	if s.absE.Before(s.exp) {
		s.exp = s.absE
	}
	s.fakeSessions.renewCalled++
	s.fakeSessions.renewedCount++
	return s.exp, true, nil
}

func sessionCookieExpires(t *testing.T, w *httptest.ResponseRecorder) time.Time {
	t.Helper()
	for _, c := range w.Result().Cookies() {
		if c.Name == "tk_auth" {
			return c.Expires
		}
	}
	t.Fatal("响应应携带 tk_auth 会话 cookie")
	return time.Time{}
}

func TestAuthenticate_SlidingRenewal_RefreshesCookieWhenRenewed(t *testing.T) {

	exp := time.Now().Add(7 * 24 * time.Hour).UTC().Truncate(time.Second)
	s := &fakeSessions{p: &Principal{UserID: "u1"}, renewExp: exp, renewed: true}
	w, reached := doAuth(t, s, &fakePATs{}, reqWithCookie("tk_auth", "tok"))
	if w.Code != http.StatusOK || !reached {
		t.Fatalf("status = %d reached = %v, want 200 + reached", w.Code, reached)
	}
	if got := sessionCookieExpires(t, w); !got.Equal(exp) {
		t.Fatalf("cookie Expires = %v, want %v（真续期必须刷新 cookie）", got, exp)
	}
	if s.renewCalled != 1 {
		t.Fatalf("RenewSession 调用 %d 次, want 1", s.renewCalled)
	}
}

func TestAuthenticate_SlidingRenewal_NoCookieWhenThrottled(t *testing.T) {
	s := &fakeSessions{p: &Principal{UserID: "u1"}, renewed: false}
	w, reached := doAuth(t, s, &fakePATs{}, reqWithCookie("tk_auth", "tok"))
	if w.Code != http.StatusOK || !reached {
		t.Fatalf("status = %d reached = %v, want 200 + reached", w.Code, reached)
	}
	if len(w.Result().Cookies()) != 0 {
		t.Fatalf("未续期不应下发 cookie, got %v", w.Result().Cookies())
	}
	if s.renewCalled != 1 {
		t.Fatalf("RenewSession 调用 %d 次, want 1", s.renewCalled)
	}
}

func TestAuthenticate_RenewalError_DoesNotBlockRequest(t *testing.T) {
	s := &fakeSessions{p: &Principal{UserID: "u1"}, renewErr: errors.New("db down")}
	w, reached := doAuth(t, s, &fakePATs{}, reqWithCookie("tk_auth", "tok"))
	if w.Code != http.StatusOK || !reached {
		t.Fatalf("status = %d reached = %v, want 200 + 续期失败不阻断", w.Code, reached)
	}
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("续期失败不应下发 cookie")
	}
}

func TestAuthenticate_SevenDayActiveUser_NeverLosesCookie(t *testing.T) {
	const ttl = 7 * 24 * time.Hour
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	store := &slidingStore{ttl: ttl, exp: t0.Add(ttl), absE: t0.Add(30 * 24 * time.Hour)}
	store.p = &Principal{UserID: "u1"}

	cookieExp := t0.Add(ttl)
	cfg := &AuthConfig{CookieName: "tk_auth", SessionTTL: ttl, Secure: false}

	for day := 1; day <= 26; day++ {
		now := t0.Add(time.Duration(day) * 24 * time.Hour)
		store.vnow = now
		w, reached := doAuthCfg(t, cfg, store, &fakePATs{}, reqWithCookie("tk_auth", "tok"))
		if !reached {
			t.Fatalf("day %d: 请求被阻断", day)
		}
		if exp := sessionCookieExpiresSilent(w); !exp.IsZero() {
			cookieExp = exp
		}
		if remain := cookieExp.Sub(now); remain <= ttl/2 {
			t.Fatalf("day %d: cookie 剩余寿命 %v ≤ 半 TTL（活跃用户会被登出）", day, remain)
		}
	}

	if store.fakeSessions.renewedCount == 0 || store.fakeSessions.renewedCount >= 26 {
		t.Fatalf("真续期次数 %d 异常（应远小于请求数且 > 0）", store.fakeSessions.renewedCount)
	}
}

func sessionCookieExpiresSilent(w *httptest.ResponseRecorder) time.Time {
	for _, c := range w.Result().Cookies() {
		if c.Name == "tk_auth" {
			return c.Expires
		}
	}
	return time.Time{}
}

func TestAuthenticate_CustomPATPrefix(t *testing.T) {
	cfg := &AuthConfig{CookieName: "tk_auth", SessionTTL: time.Hour, Secure: false, PATPrefix: "pk_"}

	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer pk_abc")
	pats := &fakePATs{p: &Principal{UserID: "u1", Source: SourcePAT}}
	w, reached := doAuthCfg(t, cfg, &fakeSessions{}, pats, r)
	if w.Code != http.StatusOK || !reached || !pats.called {
		t.Fatalf("自定义前缀 pk_ 应走 PAT 通道: code=%d reached=%v called=%v", w.Code, reached, pats.called)
	}

	r2 := httptest.NewRequest("GET", "/", nil)
	r2.Header.Set("Authorization", "Bearer tk_abc")
	pats2 := &fakePATs{p: &Principal{UserID: "u1"}}
	w2, reached2 := doAuthCfg(t, cfg, &fakeSessions{}, pats2, r2)
	if !reached2 || pats2.called {
		t.Fatalf("配置自定义前缀后 tk_ 不应走 PAT: reached=%v called=%v", reached2, pats2.called)
	}
	_ = w2
}

func TestAuthenticate_DefaultPATPrefix_Regression(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer tk_abc")
	pats := &fakePATs{p: &Principal{UserID: "u1"}}
	w, reached := doAuth(t, &fakeSessions{}, pats, r)
	if w.Code != http.StatusOK || !reached || !pats.called {
		t.Fatalf("默认前缀 tk_ 应回归不变: code=%d reached=%v called=%v", w.Code, reached, pats.called)
	}
	if DefaultPATPrefix != "tk_" {
		t.Fatalf("DefaultPATPrefix = %q, want tk_", DefaultPATPrefix)
	}
}
