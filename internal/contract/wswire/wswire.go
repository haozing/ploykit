package wswire

import (
	"encoding/json"
	"fmt"
	"sort"
)

type Frame struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
	EventID string          `json:"event_id,omitempty"`
}

const (
	CtrlAuth       = "auth"
	CtrlSubscribe  = "subscribe"
	CtrlUnsub      = "unsubscribe"
	ConfirmPrefix  = "confirmed:"
	RejectedPrefix = "rejected:"
)

const (
	ScopeWorkspace = "workspace"
	ScopeUser      = "user"
)

const (
	CapBatch        = "batch"
	CapNotification = "notification"
	CapWorkspace    = "workspace"
)

var (
	reservedScopes       = map[string]struct{}{ScopeWorkspace: {}, ScopeUser: {}}
	reservedCapabilities = map[string]struct{}{CapBatch: {}, CapNotification: {}, CapWorkspace: {}}
)

var (
	registeredScopes       = map[string]struct{}{}
	registeredCapabilities = map[string]struct{}{}
)

const nameMaxLen = 32

func validName(name string) bool {
	if len(name) == 0 || len(name) > nameMaxLen {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		switch {
		case c >= 'a' && c <= 'z':
		case (c >= '0' && c <= '9') || c == '_':
			if i == 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func RegisterScope(name string) error {
	if !validName(name) {
		return fmt.Errorf("wswire: invalid scope name %q: must start with a lowercase letter, contain only [a-z0-9_], max %d chars", name, nameMaxLen)
	}
	if _, ok := reservedScopes[name]; ok {
		return fmt.Errorf("wswire: scope %q is reserved by the framework", name)
	}
	if _, ok := registeredScopes[name]; ok {
		return fmt.Errorf("wswire: scope %q already registered", name)
	}
	registeredScopes[name] = struct{}{}
	return nil
}

func RegisterCapability(name string) error {
	if !validName(name) {
		return fmt.Errorf("wswire: invalid capability name %q: must start with a lowercase letter, contain only [a-z0-9_], max %d chars", name, nameMaxLen)
	}
	if _, ok := reservedCapabilities[name]; ok {
		return fmt.Errorf("wswire: capability %q is reserved by the framework", name)
	}
	if _, ok := registeredCapabilities[name]; ok {
		return fmt.Errorf("wswire: capability %q already registered", name)
	}
	registeredCapabilities[name] = struct{}{}
	return nil
}

func IsRegisteredScope(name string) bool {
	_, ok := registeredScopes[name]
	return ok
}

func Capabilities() []string {
	out := []string{CapBatch, CapNotification, CapWorkspace}
	registered := make([]string, 0, len(registeredCapabilities))
	for c := range registeredCapabilities {
		registered = append(registered, c)
	}
	sort.Strings(registered)
	return append(out, registered...)
}

const ConnectedFrameType = "connected"

func ScopeKey(prefix, id string) string { return prefix + ":" + id }

func WSName(dotEvent string) string {
	for i := 0; i < len(dotEvent); i++ {
		if dotEvent[i] == '.' {
			return dotEvent[:i] + ":" + dotEvent[i+1:]
		}
	}
	return dotEvent
}
