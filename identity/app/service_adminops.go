package app

import (
	"context"
	"errors"
	"fmt"
	"net/url"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

func (s *AccountService) ResetPasswordFor(ctx context.Context, targetUserID string) error {
	u, err := s.repo.GetUser(ctx, targetUserID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("user not found")
		}
		return err
	}
	return s.RequestPasswordReset(ctx, u.Email)
}

func (s *AccountService) ResendVerificationFor(ctx context.Context, email string) error {
	u, ok, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewNotFound("user not found")
	}
	if u.EmailVerified {
		return webx.NewConflict("邮箱已验证")
	}
	if ch, err := s.repo.LatestPendingChallenge(ctx, email, kindVerifyLink); err != nil {
		return err
	} else if ch != nil && s.now().Sub(ch.CreatedAt) < linkCooldown {
		return webx.NewRateLimited("请求过于频繁，请稍后再试")
	}
	token, err := domain.MintLinkToken()
	if err != nil {
		return err
	}
	if err := s.repo.CreateChallenge(ctx, email, kindVerifyLink,
		domain.HashSecret(s.cfg.SecretPepper, token), s.now().Add(domain.VerifyLinkTTL)); err != nil {
		return err
	}
	link := fmt.Sprintf("%s/verify-email?email=%s&token=%s", s.cfg.LinkBaseURL, url.QueryEscape(email), token)
	return s.mail.SendEmailVerification(ctx, email, link)
}

func (s *AccountService) MarkVerified(ctx context.Context, targetUserID string) error {
	return s.repo.SetEmailVerified(ctx, targetUserID, s.now())
}

func (s *AccountService) DeleteAccountFor(ctx context.Context, actor *webx.Principal, targetUserID string) error {
	err := s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return s.repo.SoftDeleteUserTx(ctx, tx, targetUserID, s.now())
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("account not found")
		}
		return err
	}
	if s.auditor != nil && actor != nil {
		s.auditor.Record(ctx, nil, actor, "account.deleted", "user", targetUserID,
			map[string]any{"via": "admin"})
	}
	return nil
}

func (s *SessionService) ListSessionsFor(ctx context.Context, targetUserID string) ([]SessionInfo, error) {
	return s.repo.ListUserSessions(ctx, targetUserID)
}

func (s *SessionService) RevokeSessionByIDFor(ctx context.Context, targetUserID, sessionID string) error {
	if err := s.repo.RevokeUserSessionByID(ctx, targetUserID, sessionID, s.now()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("session not found")
		}
		return err
	}
	return nil
}

func (s *SessionService) RevokeAllSessionsFor(ctx context.Context, targetUserID string) error {
	return s.repo.RevokeAllUserSessions(ctx, targetUserID)
}

func (s *TokenService) ListPATsFor(ctx context.Context, targetUserID string) ([]PAT, error) {
	return s.repo.ListPATs(ctx, targetUserID)
}

func (s *TokenService) RevokePATFor(ctx context.Context, targetUserID, patID string) error {
	if err := s.repo.RevokePAT(ctx, targetUserID, patID, s.now()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("token not found")
		}
		return err
	}
	return nil
}

// AdminCreateUser provisions a user from the admin surface (aifengkong #1):
// no email is sent, no session is established, and the signup gate does not
// apply — this is the no-SMTP / invite-only provisioning path self-service
// Register cannot express. The initial password is chosen by the caller
// (typically generated, shown to the admin exactly once); the framework only
// hashes and stores it. Fires AfterRegister transactionally so products can
// bind roles inside the same tx.
func (s *AccountService) AdminCreateUser(ctx context.Context, actor *webx.Principal, rawEmail, displayName, initialPassword string) (User, error) {
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) {
		return User{}, webx.NewValidation("invalid email")
	}
	if !domain.PasswordOK(initialPassword) {
		return User{}, webx.NewValidation("password too weak (need 10+ chars, 3 of 4 character kinds)")
	}
	name, ok := domain.NormalizeDisplayName(displayName)
	if !ok {
		return User{}, webx.NewValidation("display_name must be 1-100 characters after trim")
	}
	hash, err := HashPassword(initialPassword)
	if err != nil {
		return User{}, err
	}
	var user User
	err = s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var e error
		user, e = s.repo.CreateUserWithPasswordTx(ctx, tx, email, hash, name)
		if e != nil {
			return e
		}
		// afterRegister runs inside the tx on purpose: role binding in the
		// hook shares the create's atomicity (a failed bind rolls back the user).
		if s.identityHooks.AfterRegister != nil {
			return s.identityHooks.AfterRegister(ctx, tx, user.ID)
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrDuplicate) {
			return User{}, webx.NewConflict("email already registered")
		}
		return User{}, err
	}
	if s.auditor != nil && actor != nil {
		s.auditor.Record(ctx, nil, actor, "admin.user_create", "user", user.ID,
			map[string]any{"email": email})
	}
	return user, nil
}

// AdminSetPassword sets a target user's password directly from the admin
// surface (aifengkong #2): hash + store + revoke every session of that user +
// audit. No email is involved (the enterprise intranet path); the new
// password is caller-generated and shown to the admin exactly once. Whether a
// platform-admin target may be reset is the caller's policy decision.
func (s *AccountService) AdminSetPassword(ctx context.Context, actor *webx.Principal, targetUserID, newPassword string) error {
	if _, err := s.repo.GetUser(ctx, targetUserID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("user not found")
		}
		return err
	}
	if !domain.PasswordOK(newPassword) {
		return webx.NewValidation("password too weak (need 10+ chars, 3 of 4 character kinds)")
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	if err := s.repo.SetPasswordHash(ctx, targetUserID, hash, s.now()); err != nil {
		return err
	}
	if err := s.repo.RevokeAllUserSessions(ctx, targetUserID); err != nil {
		return err
	}
	if s.auditor != nil && actor != nil {
		s.auditor.Record(ctx, nil, actor, "admin.user_set_password", "user", targetUserID, nil)
	}
	return nil
}

// ListUsersByIDs batch-resolves users for display echo (aifengkong #7): the
// created_by audit-trail rendering every admin surface needs. Missing ids are
// skipped (a stale reference renders as absent, not as an error).
func (s *AccountService) ListUsersByIDs(ctx context.Context, ids []string) ([]User, error) {
	if len(ids) == 0 {
		return []User{}, nil
	}
	return s.repo.ListUsersByIDs(ctx, ids)
}
