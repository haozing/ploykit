package app

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

const OAuthStateCookie = "tk_oauth_state"

const oauthStateTTL = 10 * time.Minute

// oauthSourceTTL 是 provider 热源的缓存窗口（与 billing AtomicRegistry 的
// 30s 轮询同口径）：后台保存凭据后，服务端最长 30s 内换上新 provider 集。
const oauthSourceTTL = 30 * time.Second

type OAuthService struct {
	repo Repo
	now  Clock

	secureCookie bool

	// 静态集（无热源时的 back-compat 路径）：构造时定格，只读。
	staticProviders []OAuthProvider
	staticByName    map[string]OAuthProvider

	// 热源（v0.23.0）：设置后 providers 集按 TTL 从 src 重建，读写走 mu。
	// src 必须自身可安全并发调用；src 内部读失败应记日志并返回不含该
	// provider 的切片（热源签名无 error，日志是唯一可观测面）。
	src func() []OAuthProvider

	mu        sync.RWMutex
	hot       []OAuthProvider // 当前热集快照（nil = 尚未构建）
	hotByName map[string]OAuthProvider
	hotLoaded time.Time
	hotTTL    time.Duration // 测试缝：非正值不可用，生产恒 oauthSourceTTL
}

func NewOAuthService(repo Repo, providers []OAuthProvider, now Clock) *OAuthService {
	byName := make(map[string]OAuthProvider, len(providers))
	for _, p := range providers {
		byName[p.Name()] = p
	}
	return &OAuthService{repo: repo, staticProviders: providers, staticByName: byName, now: now}
}

func (s *OAuthService) WithSecureCookie(secure bool) *OAuthService {
	s.secureCookie = secure
	return s
}

// WithProviderSource 把服务切到 provider 热源：providers/byName 变为 30s
// TTL 缓存集（oauth-admin-config-design-audit-2026-10-31 §2.3，复刻 billing
// AtomicRegistry 的「source 出错保留旧集」精神——本签名无 error，src 自己
// 吞错降级）。静态构造路径不受影响：未设置热源的服务行为逐字节不变。
// 只在启动接线期调用（与 settings.RegisterKeys 同生命周期约定：并发请求
// 期间切源不受支持）；之后的 Names()/provider()/Start()/Callback() 并发安全。
func (s *OAuthService) WithProviderSource(src func() []OAuthProvider) *OAuthService {
	s.mu.Lock()
	defer s.mu.Unlock()
	if src == nil {
		return s
	}
	s.src = src
	s.hot = nil // 强制下次读取重建
	return s
}

// current 返回当前生效的 provider 集：无热源 = 静态集；有热源 = TTL 内的
// 缓存快照，过期则同步重建（读一次 src）。src 返回空切片 = 全部停用，
// 也是合法快照——热源读失败「返回 nil」正是停用语义。
func (s *OAuthService) current() ([]OAuthProvider, map[string]OAuthProvider) {
	if s.src == nil {
		return s.staticProviders, s.staticByName
	}
	s.mu.RLock()
	ttl := s.hotTTL
	if ttl <= 0 {
		ttl = oauthSourceTTL
	}
	if s.hot != nil && time.Now().Before(s.hotLoaded.Add(ttl)) {
		hot, byName := s.hot, s.hotByName
		s.mu.RUnlock()
		return hot, byName
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	// 双检：抢锁间隙可能已被并发读重建。
	if s.hot != nil && time.Now().Before(s.hotLoaded.Add(ttl)) {
		return s.hot, s.hotByName
	}
	providers := s.src()
	if providers == nil {
		// 空集是合法快照（全部停用）；规范成空切片，防 nil 与
		// hot != nil 的「未构建」哨兵混淆——否则每次读都重建。
		providers = []OAuthProvider{}
	}
	byName := make(map[string]OAuthProvider, len(providers))
	for _, p := range providers {
		byName[p.Name()] = p
	}
	s.hot, s.hotByName, s.hotLoaded = providers, byName, time.Now()
	return s.hot, s.hotByName
}

func (s *OAuthService) Names() []string {
	providers, _ := s.current()
	out := make([]string, len(providers))
	for i, p := range providers {
		out[i] = p.Name()
	}
	return out
}

func (s *OAuthService) provider(name string) (OAuthProvider, bool) {
	_, byName := s.current()
	p, ok := byName[name]
	return p, ok
}

func errProviderUnavailable(name string) error {
	return webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "oauth provider not available: "+name)
}

func requestOrigin(r *http.Request) string {
	scheme := "http"
	if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
		scheme = p
	} else if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (s *OAuthService) redirectURI(r *http.Request, provider string) string {
	return requestOrigin(r) + "/auth/oauth/" + provider + "/callback"
}

func (s *OAuthService) Start(w http.ResponseWriter, r *http.Request, providerName string) error {
	p, ok := s.provider(providerName)
	if !ok {
		return errProviderUnavailable(providerName)
	}
	state, err := domain.MintLinkToken()
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     OAuthStateCookie,
		Value:    state,
		Path:     "/",
		MaxAge:   int(oauthStateTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secureCookie,
	})
	http.Redirect(w, r, p.AuthURL(state, s.redirectURI(r, providerName)), http.StatusFound)
	return nil
}

func (s *OAuthService) Callback(ctx context.Context, r *http.Request, providerName, code, state string, gate SignupGateCheck) (ThirdPartyLinkResult, error) {
	p, ok := s.provider(providerName)
	if !ok {
		return ThirdPartyLinkResult{}, errProviderUnavailable(providerName)
	}
	ck, err := r.Cookie(OAuthStateCookie)
	// 常数时间比较（OA-4）：state 是抗 CSRF 的秘密值，比较必须走
	// subtle.ConstantTimeCompare——长度不等时它恒返回 0，空串自然被拒。
	if err != nil || ck.Value == "" || state == "" ||
		subtle.ConstantTimeCompare([]byte(ck.Value), []byte(state)) != 1 {
		return ThirdPartyLinkResult{}, webx.NewValidation("oauth state mismatch or expired")
	}
	id, err := p.Exchange(ctx, code, s.redirectURI(r, providerName))
	if err != nil {
		return ThirdPartyLinkResult{}, err
	}
	return s.link(ctx, id, gate)
}

func (s *OAuthService) link(ctx context.Context, id OAuthIdentity, gate SignupGateCheck) (ThirdPartyLinkResult, error) {
	return linkOAuthIdentity(ctx, s.repo, s.now, id, gate)
}

type SignupGateCheck = func(email string) bool

type ThirdPartyLinkResult struct {
	UserID string
	Email  string
	JITNew bool
}

func linkOAuthIdentity(ctx context.Context, repo Repo, now Clock, id OAuthIdentity, gate SignupGateCheck) (ThirdPartyLinkResult, error) {
	email := domain.NormalizeEmail(id.Email)
	if !domain.EmailOK(email) {
		return ThirdPartyLinkResult{Email: email}, webx.NewValidation("oauth email invalid")
	}

	if !id.EmailVerified {
		return ThirdPartyLinkResult{Email: email}, webx.NewForbidden("oauth email not verified; use a verified email or code login")
	}

	if uid, ok, err := repo.FindOAuthAccount(ctx, id.Provider, id.Subject); err != nil {
		return ThirdPartyLinkResult{Email: email}, err
	} else if ok {
		if _, err := repo.GetUser(ctx, uid); err != nil {
			if errors.Is(err, ErrNotFound) {
				return ThirdPartyLinkResult{Email: email}, webx.NewForbidden("account disabled")
			}
			return ThirdPartyLinkResult{Email: email}, err
		}
		return ThirdPartyLinkResult{UserID: uid, Email: email}, nil
	}

	if u, ok, err := repo.GetUserByEmail(ctx, email); err != nil {
		return ThirdPartyLinkResult{Email: email}, err
	} else if ok {
		if u.Status != "active" {
			return ThirdPartyLinkResult{Email: email}, webx.NewForbidden("account disabled")
		}
		if err := repo.LinkOAuthAccount(ctx, id.Provider, id.Subject, u.ID, email, now()); err != nil {
			return ThirdPartyLinkResult{Email: email}, err
		}
		return ThirdPartyLinkResult{UserID: u.ID, Email: email}, nil
	}

	if gate != nil && gate(email) {
		return ThirdPartyLinkResult{Email: email}, webx.NewForbidden("signup is not open for this email")
	}

	u, err := repo.UpsertUserByEmail(ctx, email, now())
	if err != nil {
		return ThirdPartyLinkResult{Email: email}, err
	}
	if u.Status != "active" {
		return ThirdPartyLinkResult{Email: email}, webx.NewForbidden("account disabled")
	}
	if err := repo.SetEmailVerified(ctx, u.ID, now()); err != nil {
		return ThirdPartyLinkResult{Email: email}, err
	}
	if err := repo.LinkOAuthAccount(ctx, id.Provider, id.Subject, u.ID, email, now()); err != nil {
		return ThirdPartyLinkResult{Email: email}, err
	}
	return ThirdPartyLinkResult{UserID: u.ID, Email: email, JITNew: true}, nil
}
