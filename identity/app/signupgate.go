package app

import (
	"github.com/haozing/ploykit/identity/domain"
)

type SignupGate = func() (allowed bool, domains []string)

func (s *SessionService) WithSignupGate(gate SignupGate) *SessionService {
	s.signupGate = gate
	return s
}

func (s *SessionService) signupBlocked(email string) bool {
	allowSignup, domains := s.cfg.AllowSignup, s.cfg.AllowedDomains
	if s.signupGate != nil {
		allowSignup, domains = s.signupGate()
	}
	if allowSignup {
		return false
	}
	return !domain.SignupAllowed(email, s.cfg.AllowedEmails, domains)
}
