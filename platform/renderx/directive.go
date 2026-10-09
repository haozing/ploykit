package renderx

import (
	"encoding/json"
	"fmt"
	"sync"
)

type DirectiveSink struct {
	mu        sync.Mutex
	dirs      []Directive
	bytes     int
	truncated bool
}

const (
	maxDirectives     = 4096
	maxDirectiveBytes = 1 << 20
)

func NewSink() *DirectiveSink { return &DirectiveSink{} }

func (s *DirectiveSink) Append(kind string, payload json.RawMessage) Directive {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.truncated || len(s.dirs) >= maxDirectives || s.bytes+len(payload) > maxDirectiveBytes {
		s.truncated = true
		return Directive{Seq: -1}
	}
	s.bytes += len(payload)
	d := Directive{Kind: kind, Payload: payload, Seq: len(s.dirs) + 1}
	s.dirs = append(s.dirs, d)
	return d
}

func (s *DirectiveSink) Truncated() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.truncated
}

func (s *DirectiveSink) Directives() []Directive {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Directive, len(s.dirs))
	copy(out, s.dirs)
	return out
}

func HeadEntries(dirs []Directive) ([]HeadEntry, error) {
	var out []HeadEntry
	for _, d := range dirs {
		if d.Kind != "head" {
			continue
		}
		var entries []HeadEntry
		if err := json.Unmarshal(d.Payload, &entries); err != nil {
			return nil, fmt.Errorf("%w: head payload: %v", ErrInvalidDirective, err)
		}
		out = append(out, entries...)
	}
	return out, nil
}
