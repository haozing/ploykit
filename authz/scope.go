package authz

import (
	"fmt"
	"strings"
	"sync"
)

type ScopePath struct {
	WorkspaceID string

	ProjectID string
}

type segKind uint8

const (
	segLiteral segKind = iota
	segWorkspace
	segProject
)

type scopeSeg struct {
	kind    segKind
	literal string
}

type scopeShape struct {
	segs     []scopeSeg
	literals int
}

var (
	scopeMu     sync.RWMutex
	scopeShapes []scopeShape
)

func RegisterScopeShape(shape string) error {
	ss, err := parseScopeShape(shape)
	if err != nil {
		return err
	}
	scopeMu.Lock()
	defer scopeMu.Unlock()
	for _, existing := range scopeShapes {
		if sameScopeShape(existing, ss) {
			return nil
		}
	}
	scopeShapes = append(scopeShapes, ss)
	return nil
}

func ParseScopePath(path string) (ScopePath, bool) {
	scopeMu.RLock()
	defer scopeMu.RUnlock()
	parts := splitScopePath(path)
	if parts == nil {
		return ScopePath{}, false
	}
	var (
		best     ScopePath
		bestSpec = -1
	)
	for _, ss := range scopeShapes {
		if len(ss.segs) != len(parts) {
			continue
		}
		var sp ScopePath
		ok := true
		for i, seg := range ss.segs {
			switch seg.kind {
			case segLiteral:
				if seg.literal != parts[i] {
					ok = false
				}
			case segWorkspace:
				sp.WorkspaceID = parts[i]
			case segProject:
				sp.ProjectID = parts[i]
			}
			if !ok {
				break
			}
		}
		if ok && ss.literals > bestSpec {
			best, bestSpec = sp, ss.literals
		}
	}
	return best, bestSpec >= 0
}

func parseScopeShape(shape string) (scopeShape, error) {
	parts := splitScopePath(shape)
	if parts == nil {
		return scopeShape{}, fmt.Errorf("authz: invalid scope shape %q: must start with '/' and have non-empty segments", shape)
	}
	out := scopeShape{segs: make([]scopeSeg, 0, len(parts))}
	vars := 0
	for _, p := range parts {
		name, isVar := scopeVar(p)
		if !isVar {
			out.segs = append(out.segs, scopeSeg{kind: segLiteral, literal: p})
			out.literals++
			continue
		}
		if name == "" {
			return scopeShape{}, fmt.Errorf("authz: invalid scope shape %q: empty variable name in %q", shape, p)
		}
		seg := scopeSeg{kind: segWorkspace}
		if vars == 1 {
			seg.kind = segProject
		}
		vars++
		out.segs = append(out.segs, seg)
	}
	if vars < 1 || vars > 2 {
		return scopeShape{}, fmt.Errorf("authz: invalid scope shape %q: want 1 or 2 variables (two layers max), got %d", shape, vars)
	}
	return out, nil
}

func scopeVar(seg string) (string, bool) {
	if !strings.HasPrefix(seg, "{") || !strings.HasSuffix(seg, "}") {
		return "", false
	}
	return seg[1 : len(seg)-1], true
}

func splitScopePath(p string) []string {
	if !strings.HasPrefix(p, "/") {
		return nil
	}
	parts := strings.Split(p[1:], "/")
	for _, s := range parts {
		if s == "" {
			return nil
		}
	}
	return parts
}

func sameScopeShape(a, b scopeShape) bool {
	if len(a.segs) != len(b.segs) || a.literals != b.literals {
		return false
	}
	for i := range a.segs {
		if a.segs[i] != b.segs[i] {
			return false
		}
	}
	return true
}
