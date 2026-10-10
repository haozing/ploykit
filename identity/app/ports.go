package app

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/platform/webx"
)

type Clock func() time.Time

type EmailSender interface {
	SendLoginCode(ctx context.Context, to, code string) error
	SendInvite(ctx context.Context, to, workspaceName, invitationID string) error
	SendPasswordReset(ctx context.Context, to, link string) error
	SendEmailVerification(ctx context.Context, to, link string) error
}

type Auditor interface {
	Record(ctx context.Context, workspaceID *string, p *webx.Principal, action, resourceType, resourceID string, meta map[string]any)
}

type Repo interface {
	UpsertUserByEmail(ctx context.Context, email string, now time.Time) (User, error)
	GetUser(ctx context.Context, id string) (User, error)
	GetUserByEmail(ctx context.Context, email string) (User, bool, error)
	UpdateProfile(ctx context.Context, id, displayName, avatarURL string) (User, error)
	CreateUserWithPassword(ctx context.Context, email, passwordHash, displayName string) (User, error)
	SetPasswordHash(ctx context.Context, userID, passwordHash string, now time.Time) error
	SetEmailVerified(ctx context.Context, userID string, at time.Time) error

	FindOAuthAccount(ctx context.Context, provider, subject string) (userID string, ok bool, err error)

	LinkOAuthAccount(ctx context.Context, provider, subject, userID, emailAtLink string, now time.Time) error

	GetFedProvider(ctx context.Context, workspaceID string) (*FedProviderRow, bool, error)

	UpsertFedProvider(ctx context.Context, row *FedProviderRow, now time.Time) error

	DeleteFedProvider(ctx context.Context, workspaceID string) error

	CreateChallenge(ctx context.Context, email, kind, secretHash string, expiresAt time.Time) error
	LatestPendingChallenge(ctx context.Context, email, kind string) (*Challenge, error)
	IncChallengeAttempts(ctx context.Context, id string) error
	ConsumeChallenge(ctx context.Context, id string) error

	CreateSession(ctx context.Context, in webx.SessionCreate) (token string, exp time.Time, err error)
	VerifySession(ctx context.Context, token string, now time.Time) (*webx.Principal, error)

	// ConfirmSessionPassword stamps password_confirmed_at on a live session
	// (step-up): POST /auth/confirm-password → RequireRecentAuth unblocks.
	ConfirmSessionPassword(ctx context.Context, sessionID string, now time.Time) error

	RenewSession(ctx context.Context, token string, now time.Time) (exp time.Time, renewed bool, err error)
	RevokeSession(ctx context.Context, token string) error
	RevokeAllUserSessions(ctx context.Context, userID string) error
	ListUserSessions(ctx context.Context, userID string) ([]SessionInfo, error)

	RevokeUserSessionByID(ctx context.Context, userID, sessionID string, now time.Time) error

	CreatePAT(ctx context.Context, userID, name, tokenHash, prefix string, expiresAt *time.Time, scope *webx.CredentialScope) (PAT, error)
	ResolvePAT(ctx context.Context, token string, now time.Time) (*webx.Principal, error)
	ListPATs(ctx context.Context, userID string) ([]PAT, error)
	RevokePAT(ctx context.Context, userID, patID string, now time.Time) error

	CountRecentAttempts(ctx context.Context, ipHash, identity string, since time.Time) (int, error)
	RecordAttempt(ctx context.Context, ipHash, identity string, success bool, at time.Time) error
	CleanupAttempts(ctx context.Context, before time.Time) error

	RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error
	CreateUserWithPasswordTx(ctx context.Context, tx pgx.Tx, email, passwordHash, displayName string) (User, error)

	SoftDeleteUserTx(ctx context.Context, tx pgx.Tx, userID string, now time.Time) error
}

type OAuthIdentity struct {
	Provider      string
	Subject       string
	Email         string
	Name          string
	EmailVerified bool
}

type OAuthProvider interface {
	Name() string

	AuthURL(state, redirectURI string) string

	Exchange(ctx context.Context, code, redirectURI string) (OAuthIdentity, error)
}

type FedProviderRow struct {
	WorkspaceID  string    `json:"workspace_id"`
	IssuerURL    string    `json:"issuer_url"`
	ClientID     string    `json:"client_id"`
	ClientSecret string    `json:"client_secret"`
	Scopes       string    `json:"scopes"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type FedOIDCProvider interface {
	Name() string

	AuthURL(state, redirectURI, verifier string) string

	Exchange(ctx context.Context, code, redirectURI, verifier string) (OAuthIdentity, error)
}

type FedResolver interface {
	Resolve(ctx context.Context, issuerURL, clientID, clientSecret, scopes string) (FedOIDCProvider, error)
}

type SessionInfo struct {
	ID         string    `json:"id"`
	IPHash     string    `json:"ip_hash"`
	UserAgent  string    `json:"user_agent"`
	LastSeenAt time.Time `json:"last_seen_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	CreatedAt  time.Time `json:"created_at"`

	Current bool `json:"current"`

	ImpersonatedBy string `json:"impersonated_by,omitempty"`
}
