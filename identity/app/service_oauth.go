package app

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

const OAuthStateCookie = "tk_oauth_state"

const oauthStateTTL = 10 * time.Minute

type OAuthService struct {
	repo      Repo
	providers []OAuthProvider
	byName    map[string]OAuthProvider
	now       Clock

	secureCookie bool
}

func NewOAuthService(repo Repo, providers []OAuthProvider, now Clock) *OAuthService {
	byName := make(map[string]OAuthProvider, len(providers))
	for _, p := range providers {
		byName[p.Name()] = p
	}
	return &OAuthService{repo: repo, providers: providers, byName: byName, now: now}
}

func (s *OAuthService) WithSecureCookie(secure bool) *OAuthService {
	s.secureCookie = secure
	return s
}

func (s *OAuthService) Names() []string {
	out := make([]string, len(s.providers))
	for i, p := range s.providers {
		out[i] = p.Name()
	}
	return out
}

func (s *OAuthService) provider(name string) (OAuthProvider, bool) {
	p, ok := s.byName[name]
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
	if err != nil || ck.Value == "" || ck.Value != state {
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
