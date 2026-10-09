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
