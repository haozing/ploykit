package app

import (
	"context"
	"crypto/hmac"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/identity"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type SessionConfig struct {
	SecretPepper string

	AllowSignup    bool
	AllowedEmails  []string
	AllowedDomains []string

	DevCode string

	Production bool

	MaxAttemptsPerIP int
	AttemptWindow    time.Duration
}

func (c SessionConfig) withDefaults() SessionConfig {
	if c.Production && c.DevCode != "" {

		panic("identity: SessionConfig.Production=true but DevCode is set (I15): universal login codes must not exist in production")
	}
	if c.MaxAttemptsPerIP == 0 {
		c.MaxAttemptsPerIP = 10
	}
	if c.AttemptWindow == 0 {
		c.AttemptWindow = 15 * time.Minute
	}
	return c
}

type SessionService struct {
	repo  Repo
	mail  EmailSender
	cfg   SessionConfig
	now   Clock
	ttl   time.Duration
	hooks identity.IdentityHooks

	signupGate func() (allowed bool, domains []string)
}

func NewSessionService(repo Repo, mail EmailSender, cfg SessionConfig, sessionTTL, _ time.Duration, now Clock) *SessionService {
	return &SessionService{repo: repo, mail: mail, cfg: cfg.withDefaults(), now: now, ttl: sessionTTL}
}

func (s *SessionService) WithHooks(h identity.IdentityHooks) *SessionService {
	s.hooks = h
	return s
}

func (s *SessionService) sessionIDOf(ctx context.Context, token string) string {
	p, err := s.repo.VerifySession(ctx, token, s.now())
	if err != nil || p == nil {
		return ""
	}
	return p.SessionID
}

func (s *SessionService) fireLoginFailed(ctx context.Context, email, ipHash string) {
	if s.hooks.OnLoginFailed == nil {
		return
	}
	if err := s.hooks.OnLoginFailed(ctx, email, ipHash); err != nil {
		slog.Warn("identity: OnLoginFailed hook failed", "err", err, "email", email)
	}
}

func (s *SessionService) SignupBlocked(email string) bool { return s.signupBlocked(email) }

func (s *SessionService) FireOnLoginFailed(ctx context.Context, email, ipHash string) {
	s.fireLoginFailed(ctx, email, ipHash)
}

func (s *SessionService) CompleteThirdPartyLogin(ctx context.Context, userID string, jitNew bool, ipHash, userAgent string) (*LoginResult, error) {
	user, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	token, exp, err := s.repo.CreateSession(ctx, webx.SessionCreate{
		UserID: user.ID, IPHash: ipHash, UserAgent: userAgent, Now: s.now(),
	})
	if err != nil {
		return nil, err
	}

	_ = s.repo.RecordAttempt(ctx, ipHash, user.Email, true, s.now())
	if jitNew && s.hooks.AfterRegister != nil {
		if err := s.hooks.AfterRegister(ctx, nil, user.ID); err != nil {
			slog.Warn("identity: AfterRegister hook failed (third-party JIT)", "err", err, "user_id", user.ID)
		}
	}
	if s.hooks.AfterLogin != nil {

		if err := s.hooks.AfterLogin(ctx, user.ID, s.sessionIDOf(ctx, token)); err != nil {
			slog.Warn("identity: AfterLogin hook failed", "err", err, "user_id", user.ID)
		}
	}
	return &LoginResult{Token: token, Exp: exp, User: user}, nil
}

type LoginResult struct {
	Token string    `json:"-"`
	Exp   time.Time `json:"expires_at"`
	User  User      `json:"user"`
}

func (s *SessionService) tooManyAttempts(ctx context.Context, ipHash, email string) (bool, error) {
	n, err := s.repo.CountRecentAttempts(ctx, ipHash, email, s.now().Add(-s.cfg.AttemptWindow))
	if err != nil {
		return false, err
	}
	return n >= s.cfg.MaxAttemptsPerIP, nil
}

func (s *SessionService) SendCode(ctx context.Context, ipHash, rawEmail string) error {
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) {
		return webx.NewValidation("invalid email")
	}
	limited, err := s.tooManyAttempts(ctx, ipHash, email)
	if err != nil {
		return err
	}
	if limited {
		return webx.NewRateLimited("too many attempts, retry later")
	}
	if latest, err := s.repo.LatestPendingChallenge(ctx, email, "login_code"); err != nil {
		return err
	} else if latest != nil && s.now().Sub(latest.CreatedAt) < domain.ResendCooldown {
		return webx.NewRateLimited("please wait before requesting another code")
	}
	code, err := domain.IssueCode()
	if err != nil {
		return err
	}
	if err := s.repo.CreateChallenge(ctx, email, "login_code",
		domain.HashSecret(s.cfg.SecretPepper, code), domain.CodeExpiry(s.now())); err != nil {
		return err
	}
	return s.mail.SendLoginCode(ctx, email, code)
}

func (s *SessionService) VerifyCode(ctx context.Context, ipHash, userAgent, rawEmail, code string) (*LoginResult, error) {
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) {
		return nil, webx.NewValidation("invalid email")
	}

	if s.cfg.Production && s.cfg.DevCode != "" && code == s.cfg.DevCode {
		slog.Error("identity: dev code login attempted under Production (I15)", "ip_hash", ipHash)
		s.fireLoginFailed(ctx, email, ipHash)
		return nil, webx.NewUnauthenticated("invalid code")
	}

	if s.cfg.DevCode != "" && code == s.cfg.DevCode {

	} else {
		if !domain.CodeOK(code) {
			return nil, webx.NewValidation("invalid code format")
		}
		ch, err := s.repo.LatestPendingChallenge(ctx, email, "login_code")
		if err != nil {
			return nil, err
		}
		now := s.now()
		if ch == nil || now.After(ch.ExpiresAt) {
			s.fireLoginFailed(ctx, email, ipHash)
			return nil, webx.NewUnauthenticated("code expired or not found")
		}
		if ch.Attempts >= domain.CodeMaxTries {
			s.fireLoginFailed(ctx, email, ipHash)
			return nil, webx.NewUnauthenticated("too many attempts")
		}

		if !hmac.Equal([]byte(ch.SecretHash), []byte(domain.HashSecret(s.cfg.SecretPepper, code))) {
			_ = s.repo.IncChallengeAttempts(ctx, ch.ID)
			_ = s.repo.RecordAttempt(ctx, ipHash, email, false, now)
			s.fireLoginFailed(ctx, email, ipHash)
			return nil, webx.NewUnauthenticated("code mismatch")
		}
		if err := s.repo.ConsumeChallenge(ctx, ch.ID); err != nil {
			return nil, err
		}
	}

	if s.signupBlocked(email) {
		if _, exists, err := s.repo.GetUserByEmail(ctx, email); err != nil {
			return nil, err
		} else if !exists {
			return nil, webx.NewForbidden("signup is not open for this email")
		}
	}

	var jitNew bool
	if s.hooks.AfterRegister != nil {
		_, existed, err := s.repo.GetUserByEmail(ctx, email)
		if err != nil {
			return nil, err
		}
		jitNew = !existed
	}
	user, err := s.repo.UpsertUserByEmail(ctx, email, s.now())
	if err != nil {
		return nil, err
	}
	if user.Status != "active" {
		return nil, webx.NewForbidden("account disabled")
	}
	token, exp, err := s.repo.CreateSession(ctx, webx.SessionCreate{
		UserID: user.ID, IPHash: ipHash, UserAgent: userAgent, Now: s.now(),
	})
	if err != nil {
		return nil, err
	}
	_ = s.repo.RecordAttempt(ctx, ipHash, email, true, s.now())

	if jitNew && s.hooks.AfterRegister != nil {
		if err := s.hooks.AfterRegister(ctx, nil, user.ID); err != nil {
			slog.Warn("identity: AfterRegister hook failed (JIT code login)", "err", err, "user_id", user.ID)
		}
	}
	if s.hooks.AfterLogin != nil {

		if err := s.hooks.AfterLogin(ctx, user.ID, s.sessionIDOf(ctx, token)); err != nil {
			slog.Warn("identity: AfterLogin hook failed", "err", err, "user_id", user.ID)
		}
	}
	return &LoginResult{Token: token, Exp: exp, User: user}, nil
}

func (s *SessionService) Register(ctx context.Context, ipHash, userAgent, rawEmail, password, displayName string) (*LoginResult, error) {
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) {
		return nil, webx.NewValidation("invalid email")
	}
	if !domain.PasswordOK(password) {
		return nil, webx.NewValidation("password too weak (need 10+ chars, 3 of 4 character kinds)")
	}

	displayName, ok := domain.NormalizeDisplayName(displayName)
	if !ok {
		return nil, webx.NewValidation("display_name must be 1-100 characters after trim")
	}
	if s.signupBlocked(email) {
		return nil, webx.NewForbidden("signup is not open for this email")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	var user User
	if s.hooks.AfterRegister != nil {

		err = s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
			var err error
			user, err = s.repo.CreateUserWithPasswordTx(ctx, tx, email, hash, displayName)
			if err != nil {
				return err
			}
			return s.hooks.AfterRegister(ctx, tx, user.ID)
		})
	} else {
		user, err = s.repo.CreateUserWithPassword(ctx, email, hash, displayName)
	}
	if err != nil {
		if errors.Is(err, ErrDuplicate) {
			return nil, webx.NewConflict("email already registered")
		}
		return nil, err
	}

	token, exp, err := s.repo.CreateSession(ctx, webx.SessionCreate{
		UserID: user.ID, IPHash: ipHash, UserAgent: userAgent, Now: s.now(),
		PasswordConfirmed: true,
	})
	if err != nil {
		return nil, err
	}
	return &LoginResult{Token: token, Exp: exp, User: user}, nil
}

func (s *SessionService) LoginWithPassword(ctx context.Context, ipHash, userAgent, rawEmail, password string) (*LoginResult, error) {
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) || password == "" {
		_ = s.repo.RecordAttempt(ctx, ipHash, email, false, s.now())
		s.fireLoginFailed(ctx, email, ipHash)
		return nil, webx.NewValidation("invalid credentials")
	}
	if limited, err := s.tooManyAttempts(ctx, ipHash, email); err != nil {
		return nil, err
	} else if limited {
		return nil, webx.NewRateLimited("too many attempts, retry later")
	}
	user, exists, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, err
	}

	hash := user.PasswordHash
	if !exists {
		hash = dummyPHC()
	}
	if !exists || user.Status != "active" || !VerifyPassword(password, hash) {
		_ = s.repo.RecordAttempt(ctx, ipHash, email, false, s.now())
		s.fireLoginFailed(ctx, email, ipHash)
		return nil, webx.NewUnauthenticated("invalid credentials")
	}
	token, exp, err := s.repo.CreateSession(ctx, webx.SessionCreate{
		UserID: user.ID, IPHash: ipHash, UserAgent: userAgent, Now: s.now(),
		PasswordConfirmed: true,
	})
	if err != nil {
		return nil, err
	}
	_ = s.repo.RecordAttempt(ctx, ipHash, email, true, s.now())
	if s.hooks.AfterLogin != nil {

		if err := s.hooks.AfterLogin(ctx, user.ID, s.sessionIDOf(ctx, token)); err != nil {
			slog.Warn("identity: AfterLogin hook failed", "err", err, "user_id", user.ID)
		}
	}
	return &LoginResult{Token: token, Exp: exp, User: user}, nil
}

// ConfirmPassword re-verifies the caller's password and stamps the current
// session (step-up). It backs the two-phase protocol of
// webx.RequireRecentAuth: 403 E_REAUTH_REQUIRED → confirm here → retry the
// original request. Failed confirmations go through the same attempt limiter
// as login (a hijacked session must not brute-force the password).
func (s *SessionService) ConfirmPassword(ctx context.Context, ipHash string, p *webx.Principal, password string) (time.Time, error) {
	user, err := s.repo.GetUser(ctx, p.UserID)
	if err != nil {
		return time.Time{}, err
	}
	if limited, err := s.tooManyAttempts(ctx, ipHash, user.Email); err != nil {
		return time.Time{}, err
	} else if limited {
		return time.Time{}, webx.NewRateLimited("too many attempts, retry later")
	}
	if password == "" || !VerifyPassword(password, user.PasswordHash) {
		_ = s.repo.RecordAttempt(ctx, ipHash, user.Email, false, s.now())
		s.fireLoginFailed(ctx, user.Email, ipHash)
		return time.Time{}, webx.NewUnauthenticated("invalid password")
	}
	now := s.now()
	if err := s.repo.ConfirmSessionPassword(ctx, p.SessionID, now); err != nil {
		if errors.Is(err, ErrNotFound) {
			return time.Time{}, webx.NewUnauthenticated("session no longer valid")
		}
		return time.Time{}, err
	}
	return now, nil
}

func (s *SessionService) ChangePassword(ctx context.Context, p *webx.Principal, oldPassword, newPassword string) (*LoginResult, error) {
	user, err := s.repo.GetUser(ctx, p.UserID)
	if err != nil {
		return nil, err
	}
	if !VerifyPassword(oldPassword, user.PasswordHash) {

		return nil, webx.NewUnauthenticated("当前密码不正确，请确认后重新输入")
	}

	if newPassword == oldPassword {
		return nil, webx.NewValidation("新密码不能与当前密码相同")
	}
	if !domain.PasswordOK(newPassword) {
		return nil, webx.NewValidation("new password too weak")
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SetPasswordHash(ctx, user.ID, hash, s.now()); err != nil {
		return nil, err
	}
	if err := s.repo.RevokeAllUserSessions(ctx, user.ID); err != nil {
		return nil, err
	}
	token, exp, err := s.repo.CreateSession(ctx, webx.SessionCreate{
		UserID: user.ID, Now: s.now(),
		PasswordConfirmed: true,
	})
	if err != nil {
		return nil, err
	}
	if s.hooks.AfterPasswordChange != nil {

		if err := s.hooks.AfterPasswordChange(ctx, user.ID); err != nil {
			slog.Warn("identity: AfterPasswordChange hook failed", "err", err, "user_id", user.ID)
		}
	}
	return &LoginResult{Token: token, Exp: exp, User: user}, nil
}

func (s *SessionService) Me(ctx context.Context, p *webx.Principal) (User, error) {
	u, err := s.repo.GetUser(ctx, p.UserID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return User{}, webx.NewUnauthenticated("session no longer valid")
		}
		return User{}, err
	}
	return u, nil
}

func (s *SessionService) UpdateProfile(ctx context.Context, p *webx.Principal, displayName, avatarURL string) (User, error) {

	displayName, ok := domain.NormalizeDisplayName(displayName)
	if !ok {
		return User{}, webx.NewValidation("display_name must be 1-100 characters after trim")
	}

	avatarURL = strings.TrimSpace(avatarURL)
	if !domain.AvatarURLOK(avatarURL) {
		return User{}, webx.NewValidation("avatar_url must be empty or an http(s) URL of at most 2048 characters")
	}
	return s.repo.UpdateProfile(ctx, p.UserID, displayName, avatarURL)
}

func (s *SessionService) Logout(ctx context.Context, token string) error {
	return s.repo.RevokeSession(ctx, token)
}

func (s *SessionService) ListSessions(ctx context.Context, p *webx.Principal) ([]SessionInfo, error) {
	return s.repo.ListUserSessions(ctx, p.UserID)
}

func (s *SessionService) RevokeSessionByID(ctx context.Context, p *webx.Principal, sessionID string) error {
	if err := s.repo.RevokeUserSessionByID(ctx, p.UserID, sessionID, s.now()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("session not found")
		}
		return err
	}
	return nil
}

func (s *SessionService) RevokeAllSessions(ctx context.Context, p *webx.Principal) error {
	return s.repo.RevokeAllUserSessions(ctx, p.UserID)
}
