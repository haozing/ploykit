package authorization

type ScopeKind string

const (
	ScopeKindPlatform ScopeKind = "platform"

	ScopeKindWorkspacePath ScopeKind = "workspace_path"

	ScopeKindProjectPath ScopeKind = "project_path"

	ScopeKindProjectGovernance ScopeKind = "project_governance"

	ScopeKindProjectCredential ScopeKind = "project_credential"
)

func (k ScopeKind) valid() bool {
	switch k {
	case ScopeKindPlatform, ScopeKindWorkspacePath, ScopeKindProjectPath,
		ScopeKindProjectGovernance, ScopeKindProjectCredential:
		return true
	default:
		return false
	}
}

type Scope interface {
	scope()

	Workspace() (string, bool)

	Project() (string, bool)
}

type PlatformScope struct{}

func (PlatformScope) scope()                    {}
func (PlatformScope) Workspace() (string, bool) { return "", false }
func (PlatformScope) Project() (string, bool)   { return "", false }

type WorkspaceScope struct{ WorkspaceID string }

func (WorkspaceScope) scope() {}
func (s WorkspaceScope) Workspace() (string, bool) {
	return s.WorkspaceID, s.WorkspaceID != ""
}
func (WorkspaceScope) Project() (string, bool) { return "", false }

type ProjectScope struct {
	WorkspaceID string
	ProjectID   string
}

func (ProjectScope) scope() {}
func (s ProjectScope) Workspace() (string, bool) {
	return s.WorkspaceID, s.WorkspaceID != ""
}
func (s ProjectScope) Project() (string, bool) {
	return s.ProjectID, s.ProjectID != ""
}
