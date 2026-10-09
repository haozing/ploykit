package authorization

import "time"

type Principal interface {
	principal()

	AuthMethod() AuthMethod

	Subject() string
}

type SessionPrincipal struct {
	SubjectID      string
	SessionID      string
	Assurance      Assurance
	AbsoluteExpiry time.Time
	IdleExpiry     time.Time
}

func (SessionPrincipal) principal()             {}
func (SessionPrincipal) AuthMethod() AuthMethod { return AuthMethodSession }
func (p SessionPrincipal) Subject() string      { return p.SubjectID }

type ScopedTokenPrincipal struct {
	SubjectID string
	TokenID   string
	Scope     ProjectScope
}

func (ScopedTokenPrincipal) principal()             {}
func (ScopedTokenPrincipal) AuthMethod() AuthMethod { return AuthMethodScopedToken }
func (p ScopedTokenPrincipal) Subject() string      { return p.SubjectID }

type MachineCredentialPrincipal struct {
	CredentialID string
	Scope        ProjectScope
	NotBefore    time.Time
	ExpiresAt    time.Time
}

func (MachineCredentialPrincipal) principal()             {}
func (MachineCredentialPrincipal) AuthMethod() AuthMethod { return AuthMethodMachineCredential }
func (p MachineCredentialPrincipal) Subject() string      { return p.CredentialID }

func principalScopeBinding(p Principal) (ProjectScope, bool) {
	switch typed := p.(type) {
	case ScopedTokenPrincipal:
		return typed.Scope, true
	case MachineCredentialPrincipal:
		return typed.Scope, true
	default:
		return ProjectScope{}, false
	}
}
