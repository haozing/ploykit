package app

import (
	"context"
	"crypto/hmac"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type AccountConfig struct {
	SecretPepper string

	LinkBaseURL string
}

type AccountService struct {
	repo    Repo
	mail    EmailSender
	cfg     AccountConfig
	now     Clock
	auditor Auditor
}

func NewAccountService(repo Repo, mail EmailSender, cfg AccountConfig, now Clock) *AccountService {
	return &AccountService{repo: repo, mail: mail, cfg: cfg, now: now}
}

func (s *AccountService) WithAuditor(a Auditor) *AccountService {
	s.auditor = a
	return s
}

func (s *AccountService) DeleteAccount(ctx context.Context, p *webx.Principal) error {
	if p == nil {
		return webx.NewUnauthenticated("请先登录")
	}
	err := s.repo.RunInTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return s.repo.SoftDeleteUserTx(ctx, tx, p.UserID, s.now())
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("account not found")
		}
		return err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "account.deleted", "user", p.UserID, nil)
	}
	return nil
}

const (
	kindResetLink  = "reset_link"
	kindVerifyLink = "verify_link"
	linkCooldown   = time.Minute
)

func (s *AccountService) RequestPasswordReset(ctx context.Context, rawEmail string) error {
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) {
		return webx.NewValidation("邮箱格式无效")
	}
	_, ok, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if ch, err := s.repo.LatestPendingChallenge(ctx, email, kindResetLink); err != nil {
		return err
	} else if ch != nil && s.now().Sub(ch.CreatedAt) < linkCooldown {
		return webx.NewRateLimited("请求过于频繁，请稍后再试")
	}
	token, err := domain.MintLinkToken()
	if err != nil {
		return err
	}
	if err := s.repo.CreateChallenge(ctx, email, kindResetLink,
		domain.HashSecret(s.cfg.SecretPepper, token), s.now().Add(domain.ResetLinkTTL)); err != nil {
		return err
	}
	link := fmt.Sprintf("%s/reset-password?email=%s&token=%s", s.cfg.LinkBaseURL, url.QueryEscape(email), token)
	return s.mail.SendPasswordReset(ctx, email, link)
}

func (s *AccountService) ResetPassword(ctx context.Context, rawEmail, token, newPassword string) error {
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) {
		return webx.NewValidation("邮箱格式无效")
	}
	u, ok, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewValidation("重置链接无效或已过期")
	}
	ch, err := s.verifyLinkChallenge(ctx, email, kindResetLink, token)
	if err != nil {
		return err
	}
	if !domain.PasswordOK(newPassword) {
		return webx.NewValidation("新密码强度不足（需 10+ 字符且含三类字符）")
	}
	if err := s.repo.ConsumeChallenge(ctx, ch.ID); err != nil {
		return err
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	if err := s.repo.SetPasswordHash(ctx, u.ID, hash, s.now()); err != nil {
		return err
	}
	return s.repo.RevokeAllUserSessions(ctx, u.ID)
}

func (s *AccountService) SendVerification(ctx context.Context, p *webx.Principal) error {
	if p == nil {
		return webx.NewUnauthenticated("请先登录")
	}
	u, err := s.repo.GetUser(ctx, p.UserID)
	if err != nil {
		return err
	}
	if u.EmailVerified {
		return webx.NewConflict("邮箱已验证")
	}
	if ch, err := s.repo.LatestPendingChallenge(ctx, u.Email, kindVerifyLink); err != nil {
		return err
	} else if ch != nil && s.now().Sub(ch.CreatedAt) < linkCooldown {
		return webx.NewRateLimited("请求过于频繁，请稍后再试")
	}
	token, err := domain.MintLinkToken()
	if err != nil {
		return err
	}
	if err := s.repo.CreateChallenge(ctx, u.Email, kindVerifyLink,
		domain.HashSecret(s.cfg.SecretPepper, token), s.now().Add(domain.VerifyLinkTTL)); err != nil {
		return err
	}
	link := fmt.Sprintf("%s/verify-email?email=%s&token=%s", s.cfg.LinkBaseURL, url.QueryEscape(u.Email), token)
	return s.mail.SendEmailVerification(ctx, u.Email, link)
}

func (s *AccountService) VerifyEmail(ctx context.Context, rawEmail, token string) error {
	email := domain.NormalizeEmail(rawEmail)
	if !domain.EmailOK(email) {
		return webx.NewValidation("邮箱格式无效")
	}
	u, ok, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		return err
	}
	if !ok {
		return webx.NewValidation("验证链接无效或已过期")
	}
	ch, err := s.verifyLinkChallenge(ctx, email, kindVerifyLink, token)
	if err != nil {
		return err
	}
	if err := s.repo.ConsumeChallenge(ctx, ch.ID); err != nil {
		return err
	}
	return s.repo.SetEmailVerified(ctx, u.ID, s.now())
}

func (s *AccountService) verifyLinkChallenge(ctx context.Context, email, kind, token string) (*Challenge, error) {
	ch, err := s.repo.LatestPendingChallenge(ctx, email, kind)
	if err != nil {
		return nil, err
	}
	if ch == nil {
		return nil, webx.NewValidation("链接无效或已过期")
	}
	if ch.Attempts >= domain.CodeMaxTries {
		return nil, webx.NewValidation("尝试次数过多，请重新申请")
	}
	if s.now().After(ch.ExpiresAt) {
		return nil, webx.NewValidation("链接无效或已过期")
	}

	if !hmac.Equal([]byte(ch.SecretHash), []byte(domain.HashSecret(s.cfg.SecretPepper, token))) {
		_ = s.repo.IncChallengeAttempts(ctx, ch.ID)
		return nil, webx.NewValidation("链接无效或已过期")
	}
	return ch, nil
}
