package wsx

import "github.com/haozing/ploykit/internal/contract/wswire"

func RegisterScope(name string) error { return wswire.RegisterScope(name) }

func RegisterCapability(name string) error { return wswire.RegisterCapability(name) }

func Capabilities() []string { return wswire.Capabilities() }

func WorkspaceScope(workspaceID string) string {
	return wswire.ScopeKey(wswire.ScopeWorkspace, workspaceID)
}

func UserScope(userID string) string {
	return wswire.ScopeKey(wswire.ScopeUser, userID)
}
