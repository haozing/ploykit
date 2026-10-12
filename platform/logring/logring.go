// Package logring captures slog output into an in-memory ring buffer so a
// developer agent can fetch the records behind a single failed request by its
// request id ("one artifact per failure").
//
// The handler wraps the logger's regular format handler (see
// logx.Options.WrapHandler): every record that reaches stdout is also captured
// here, indexed per request id (read from the request context, see
// webx.RequestIDFromCtx) with an LRU bound on distinct requests, plus a global
// tail window. String values are scrubbed through redactx by default so
// credentials never land in the buffer.
//
// This is a development-observability surface, not a production log sink: it
// is process-local, bounded, and loses everything on restart. Products that
// need durable logs should ship stdout to a real aggregator (the JSON format
// plus request_id correlation keeps that door open).
package logring

import (
	"container/list"
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/haozing/ploykit/platform/redactx"
	"github.com/haozing/ploykit/platform/webx"
)

const (
	defaultCapacity     = 4096 // global tail window, records
	defaultPerRequest   = 256  // records retained per request id
	defaultMaxRequests  = 512  // distinct request ids retained (LRU)
)

// Attr is one flattened key/value pair of a captured record. Group nesting is
// flattened to dotted keys, and values are stored as their string
// representation (post-redaction) so entries stay safely JSON-serializable.
type Attr struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Entry is one captured log record.
type Entry struct {
	Time      time.Time  `json:"time"`
	Level     slog.Level `json:"level"`
	Message   string     `json:"message"`
	RequestID string     `json:"request_id,omitempty"`
	Attrs     []Attr     `json:"attrs,omitempty"`
}

// Query filters and bounds a logring read.
type Query struct {
	// MinLevel drops entries below this level (default: keep everything).
	MinLevel slog.Level
	// Limit caps the result; the newest entries win. 0 means a small
	// default (100).
	Limit int
}

// Options configures a Ring. Zero values fall back to the defaults above.
type Options struct {
	// Capacity is the global tail-window size in records.
	Capacity int
	// PerRequestCapacity bounds the records retained per request id.
	PerRequestCapacity int
	// MaxRequests bounds how many distinct request ids are retained;
	// the least recently used request id is evicted first.
	MaxRequests int
	// Redact controls scrubbing captured strings through redactx.
	// Default (nil) is true.
	Redact *bool
}

// Ring is the queryable store behind a capture Handler. Create one with New.
type Ring struct {
	mu                 sync.Mutex
	tail               []Entry // global ring buffer
	tailHead           int     // index of the oldest element, when full
	capacity           int
	perRequest         int
	maxRequests        int
	redact             bool
	buckets            map[string]*bucket
	lru                *list.List // front = least recently used request id
	captured           uint64
	droppedGlobal      uint64
	droppedPerRequest  uint64
	droppedRequests    uint64
}

type bucket struct {
	entries []Entry
	head    int
	full    bool
	elem    *list.Element
}

// Stats is a point-in-time view of the ring for diagnostics.
type Stats struct {
	Captured          uint64 `json:"captured"`
	DroppedGlobal     uint64 `json:"dropped_global"`
	DroppedPerRequest uint64 `json:"dropped_per_request"`
	DroppedRequests   uint64 `json:"dropped_requests"`
	Requests          int    `json:"requests"`
}

// New returns a slog.Handler that captures every record it receives into a
// Ring and forwards them to next (typically the logx format handler). The
// returned handler's Enabled follows next, so stdout level semantics are
// unchanged and only records actually emitted are captured.
func New(next slog.Handler, opt Options) *Handler {
	r := &Ring{
		capacity:   orDefault(opt.Capacity, defaultCapacity),
		perRequest: orDefault(opt.PerRequestCapacity, defaultPerRequest),
		maxRequests: orDefault(opt.MaxRequests, defaultMaxRequests),
		redact:     opt.Redact == nil || *opt.Redact,
		buckets:    make(map[string]*bucket),
		lru:        list.New(),
	}
	return &Handler{ring: r, next: next}
}

// Handler is the capture slog.Handler. Query the backing store via Ring.
type Handler struct {
	ring   *Ring
	next   slog.Handler
	prefix []Attr // prebaked via WithAttrs, keys already flattened to the group depth at which they were added
	groups []string
}

// Ring exposes the queryable store.
func (h *Handler) Ring() *Ring { return h.ring }

// Wrap is the logx.Options.WrapHandler adapter: it builds the capture handler
// around the format handler that logx constructed, and hands the Ring back
// through the out parameter so the app can query it.
func Wrap(out **Ring, opt Options) func(slog.Handler) slog.Handler {
	return func(next slog.Handler) slog.Handler {
		h := New(next, opt)
		if out != nil {
			*out = h.Ring()
		}
		return h
	}
}

func (h *Handler) Enabled(ctx context.Context, l slog.Level) bool {
	return h.next.Enabled(ctx, l)
}

func (h *Handler) Handle(ctx context.Context, r slog.Record) error {
	h.ring.capture(ctx, r, h.prefix, h.groups)
	return h.next.Handle(ctx, r)
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	clone := *h
	for _, a := range attrs {
		prefix := h.groups
		if a.Value.Kind() == slog.KindGroup {
			// slog semantics: WithAttrs(group) bakes the group name into
			// the prefix depth too, so record-level attrs land inside it.
			base := joinKey(prefix, a.Key)
			for _, ga := range a.Value.Group() {
				clone.prefix = appendPrebaked(clone.prefix, prefix, ga, base)
			}
			continue
		}
		clone.prefix = appendPrebaked(clone.prefix, prefix, a, "")
	}
	return &clone
}

// appendPrebaked flattens one attr into a storage Attr, resolving its key
// against the group depth the attr was added at (extraPrefix is prepended for
// group-collapsed attrs).
func appendPrebaked(dst []Attr, groups []string, a slog.Attr, extraPrefix string) []Attr {
	if a.Equal(slog.Attr{}) {
		return dst
	}
	key := joinKey(groups, a.Key)
	if extraPrefix != "" {
		key = extraPrefix + "." + key
	}
	return append(dst, Attr{Key: key, Value: a.Value.String()})
}

func (h *Handler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	clone := *h
	clone.groups = append(append([]string{}, h.groups...), name)
	return &clone
}

func (r *Ring) capture(ctx context.Context, rec slog.Record, prefix []Attr, groups []string) {
	rid := webx.RequestIDFromCtx(ctx)
	e := Entry{
		Time:      rec.Time,
		Level:     rec.Level,
		Message:   r.redactString(rec.Message),
		RequestID: rid,
	}
	var flatten func(groups []string, a slog.Attr)
	flatten = func(groups []string, a slog.Attr) {
		if a.Equal(slog.Attr{}) {
			return
		}
		if a.Value.Kind() == slog.KindGroup {
			sub := append(append([]string{}, groups...), a.Key)
			for _, ga := range a.Value.Group() {
				flatten(sub, ga)
			}
			return
		}
		e.Attrs = append(e.Attrs, Attr{Key: joinKey(groups, a.Key), Value: r.redactString(a.Value.String())})
	}
	for _, a := range prefix {
		e.Attrs = append(e.Attrs, Attr{Key: a.Key, Value: r.redactString(a.Value)})
	}
	rec.Attrs(func(a slog.Attr) bool {
		flatten(groups, a)
		return true
	})

	r.mu.Lock()
	defer r.mu.Unlock()
	r.captured++

	// Global tail window.
	if len(r.tail) < r.capacity {
		r.tail = append(r.tail, e)
	} else {
		r.tail[r.tailHead] = e
		r.tailHead = (r.tailHead + 1) % r.capacity
		r.droppedGlobal++
	}

	// Per-request bucket.
	if rid == "" {
		return
	}
	b, ok := r.buckets[rid]
	if !ok {
		if len(r.buckets) >= r.maxRequests {
			if oldest := r.lru.Front(); oldest != nil {
				delete(r.buckets, oldest.Value.(string))
				r.lru.Remove(oldest)
			}
			r.droppedRequests++
		}
		b = &bucket{entries: make([]Entry, 0, 8)}
		b.elem = r.lru.PushBack(rid)
		r.buckets[rid] = b
	} else {
		r.lru.MoveToBack(b.elem)
	}
	if len(b.entries) < r.perRequest {
		b.entries = append(b.entries, e)
		if len(b.entries) == r.perRequest {
			b.full = true
			b.head = 0
		}
	} else {
		b.entries[b.head] = e
		b.head = (b.head + 1) % r.perRequest
		r.droppedPerRequest++
	}
}

// ByRequestID returns the captured entries for one request, oldest first.
func (r *Ring) ByRequestID(requestID string, q Query) []Entry {
	if requestID == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.buckets[requestID]
	if !ok {
		return nil
	}
	return filterEntries(ordered(b.entries, b.head, b.full), q)
}

// Tail returns the most recent captured entries across all requests, oldest
// first. Entries without a request id are included; use ByRequestID for
// per-request correlation.
func (r *Ring) Tail(q Query) []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Entry, 0, len(r.tail))
	for i := 0; i < len(r.tail); i++ {
		out = append(out, r.tail[(r.tailHead+i)%len(r.tail)])
	}
	return filterEntries(out, q)
}

// Stats returns counters for diagnostics.
func (r *Ring) Stats() Stats {
	r.mu.Lock()
	defer r.mu.Unlock()
	return Stats{
		Captured:          r.captured,
		DroppedGlobal:     r.droppedGlobal,
		DroppedPerRequest: r.droppedPerRequest,
		DroppedRequests:   r.droppedRequests,
		Requests:          len(r.buckets),
	}
}

func filterEntries(in []Entry, q Query) []Entry {
	limit := q.Limit
	if limit <= 0 {
		limit = 100
	}
	out := make([]Entry, 0, min(limit, len(in)))
	for _, e := range in {
		if e.Level >= q.MinLevel {
			out = append(out, e)
		}
	}
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}

func ordered(entries []Entry, head int, full bool) []Entry {
	if !full {
		return entries
	}
	out := make([]Entry, 0, len(entries))
	for i := 0; i < len(entries); i++ {
		out = append(out, entries[(head+i)%len(entries)])
	}
	return out
}

func (r *Ring) redactString(s string) string {
	if !r.redact {
		return s
	}
	return redactx.String(s)
}

func joinKey(groups []string, k string) string {
	out := k
	if len(groups) > 0 {
		out = strings.Join(groups, ".") + "." + k
	}
	return out
}

func orDefault(v, def int) int {
	if v > 0 {
		return v
	}
	return def
}
