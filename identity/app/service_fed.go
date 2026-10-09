package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

const FedLoginCookie = "tk_fed_oauth"

const fedCookieTTL = 10 * time.Minute

const FedProviderPrefix = "oidc_fed:"

const FedSecretMask = "***"

const fedDefaultScopes = "openid email profile"

type WorkspaceSlugLookup func(ctx context.Context, slug string) (string, bool, error)

type FedService struct {
	repo       Repo
	slugLookup WorkspaceSlugLookup
	resolver   FedResolver
	now        Clock
	secrets    Secrets

	secureCookie bool
}

func (s *FedService) WithSecureCookie(secure bool) *FedService {
	s.secureCookie = secure
	return s
}

type FedOption func(*FedService)

func WithSecrets(s Secrets) FedOption {
	return func(f *FedService) {
		if s != nil {
			f.secrets = s
		}
	}
}

func NewFedService(repo Repo, slugLookup WorkspaceSlugLookup, resolver FedResolver, now Clock, opts ...FedOption) *FedService {
	f := &FedService{repo: repo, slugLookup: slugLookup, resolver: resolver, now: now, secrets: noneSecrets{}}
	for _, opt := range opts {
		opt(f)
	}
	return f
}

func FedProviderKey(workspaceID string) string { return FedProviderPrefix + workspaceID }

type fedLoginCookie struct {
	S string `json:"s"`
	V string `json:"v"`
	W string `json:"w"`
}

func newFedVerifier() (string, error) {
	buf := make([]byte, 48)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *FedService) redirectURI(r *http.Request) string {
	return requestOrigin(r) + "/auth/fed/callback"
}

func (s *FedService) provider(ctx context.Context, workspaceID string) (FedOIDCProvider, error) {
	row, ok, err := s.repo.GetFedProvider(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, webx.NewNotFound("workspace sso not configured")
	}

	clientSecret, err := s.secrets.Unseal(row.ClientSecret)
	if err != nil {
		return nil, webx.NewError(http.StatusInternalServerError, CodeSealFailed,
			"client_secret unseal failed (seal key mismatch or corrupted ciphertext)")
	}
	p, err := s.resolver.Resolve(ctx, row.IssuerURL, row.ClientID, clientSecret, row.Scopes)
	if err != nil {
		return nil, webx.NewError(http.StatusServiceUnavailable, webx.CodeUnavailable, "fed idp unavailable")
	}
	return p, nil
}

func (s *FedService) Start(w http.ResponseWriter, r *http.Request, slug string) error {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return webx.NewValidation("workspace slug required")
	}
	wsID, ok, err := s.slugLookup(r.Context(), slug)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("workspace not found")
	}
	p, err := s.provider(r.Context(), wsID)
	if err != nil {
		return err
	}
	state, err := domain.MintLinkToken()
	if err != nil {
		return err
	}
	verifier, err := newFedVerifier()
	if err != nil {
		return err
	}
	cv, err := json.Marshal(fedLoginCookie{S: state, V: verifier, W: wsID})
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     FedLoginCookie,
		Value:    base64.RawURLEncoding.EncodeToString(cv),
		Path:     "/",
		MaxAge:   int(fedCookieTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secureCookie,
	})
	http.Redirect(w, r, p.AuthURL(state, s.redirectURI(r), verifier), http.StatusFound)
	return nil
}

func (s *FedService) Callback(ctx context.Context, r *http.Request, code, state string, gate SignupGateCheck) (ThirdPartyLinkResult, error) {
	ck, err := r.Cookie(FedLoginCookie)
	if err != nil || ck.Value == "" {
		return ThirdPartyLinkResult{}, webx.NewValidation("fed state missing or expired")
	}
	raw, err := base64.RawURLEncoding.DecodeString(ck.Value)
	if err != nil {
		return ThirdPartyLinkResult{}, webx.NewValidation("fed state malformed")
	}
	var fc fedLoginCookie
	if err := json.Unmarshal(raw, &fc); err != nil ||
		fc.S == "" || fc.V == "" || fc.W == "" || fc.S != state {
		return ThirdPartyLinkResult{}, webx.NewValidation("fed state mismatch or expired")
	}
	if code == "" {
		return ThirdPartyLinkResult{}, webx.NewValidation("authorization code required")
	}
	p, err := s.provider(ctx, fc.W)
	if err != nil {
		return ThirdPartyLinkResult{}, err
	}
	id, err := p.Exchange(ctx, code, s.redirectURI(r), fc.V)
	if err != nil {
		return ThirdPartyLinkResult{}, err
	}

	id.Provider = FedProviderKey(fc.W)
	return linkOAuthIdentity(ctx, s.repo, s.now, id, gate)
}

func (s *FedService) UpsertProvider(ctx context.Context, workspaceID, issuerURL, clientID, clientSecret, scopes string) (*FedProviderRow, error) {
	issuer := strings.TrimRight(strings.TrimSpace(issuerURL), "/")
	u, perr := url.Parse(issuer)
	if perr != nil || u.Scheme != "http" && u.Scheme != "https" || u.Host == "" {
		return nil, webx.NewValidation("issuer_url must be an absolute http(s) URL")
	}
	clientID = strings.TrimSpace(clientID)
	clientSecret = strings.TrimSpace(clientSecret)
	if clientID == "" || clientSecret == "" {
		return nil, webx.NewValidation("client_id and client_secret required")
	}
	if strings.TrimSpace(scopes) == "" {
		scopes = fedDefaultScopes
	}

	sealed, err := s.secrets.Seal(clientSecret)
	if err != nil {
		var we *webx.Error
		if errors.As(err, &we) {
			return nil, we
		}
		return nil, webx.NewError(http.StatusInternalServerError, CodeSealFailed,
			"client_secret seal failed: "+err.Error())
	}
	row := &FedProviderRow{
		WorkspaceID: workspaceID, IssuerURL: issuer,
		ClientID: clientID, ClientSecret: sealed, Scopes: scopes,
	}
	now := s.now()
	if err := s.repo.UpsertFedProvider(ctx, row, now); err != nil {
		return nil, err
	}
	row.UpdatedAt = now
	return row, nil
}

func (s *FedService) GetProvider(ctx context.Context, workspaceID string) (*FedProviderRow, bool, error) {
	return s.repo.GetFedProvider(ctx, workspaceID)
}

func (s *FedService) DeleteProvider(ctx context.Context, workspaceID string) error {
	if err := s.repo.DeleteFedProvider(ctx, workspaceID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("workspace sso not configured")
		}
		return err
	}
	return nil
}
