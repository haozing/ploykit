package app

import (
	"context"
	"errors"
	"time"

	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type TokenService struct {
	repo    Repo
	auditor Auditor
	now     Clock

	patPrefix string
}

func NewTokenService(repo Repo, auditor Auditor, now Clock) *TokenService {
	return &TokenService{repo: repo, auditor: auditor, now: now}
}

func (s *TokenService) WithPATPrefix(prefix string) *TokenService {
	s.patPrefix = prefix
	return s
}

func (s *TokenService) CreatePAT(ctx context.Context, p *webx.Principal, name string, ttl time.Duration, scope *webx.CredentialScope) (PAT, string, error) {
	if name == "" || len(name) > 64 {
		return PAT{}, "", webx.NewValidation("name required (<=64 chars)")
	}
	var exp *time.Time
	if ttl > 0 {
		t := s.now().Add(ttl)
		exp = &t
	}
	token, hash, prefix, err := domain.MintPAT(s.patPrefix)
	if err != nil {
		return PAT{}, "", err
	}
	pat, err := s.repo.CreatePAT(ctx, p.UserID, name, hash, prefix, exp, scope)
	if err != nil {
		return PAT{}, "", err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "pat.create", "pat", pat.ID, nil)
	}
	return pat, token, nil
}

func (s *TokenService) ListPATs(ctx context.Context, p *webx.Principal) ([]PAT, error) {
	return s.repo.ListPATs(ctx, p.UserID)
}

func (s *TokenService) RevokePAT(ctx context.Context, p *webx.Principal, patID string) error {
	if err := s.repo.RevokePAT(ctx, p.UserID, patID, s.now()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return webx.NewNotFound("token not found")
		}
		return err
	}
	if s.auditor != nil {
		s.auditor.Record(ctx, nil, p, "pat.revoke", "pat", patID, nil)
	}
	return nil
}
