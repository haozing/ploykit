package devx

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/haozing/ploykit/platform/logring"
	"github.com/haozing/ploykit/platform/webx"
)

// LogService adapts a logring Ring for the HTTP surface and MCP tools. A nil
// ring (logring not wired) yields Available=false and the surfaces answer
// with a clear degradation message instead of empty results.
type LogService struct {
	ring *logring.Ring
}

// NewLogService wraps a ring.
func NewLogService(ring *logring.Ring) *LogService { return &LogService{ring: ring} }

// Available reports whether a ring backs this service.
func (s *LogService) Available() bool { return s != nil && s.ring != nil }

// ByRequestID returns the captured entries for one request, newest last.
func (s *LogService) ByRequestID(requestID string, minLevel slog.Level, limit int) []logring.Entry {
	return s.ring.ByRequestID(requestID, logring.Query{MinLevel: minLevel, Limit: limit})
}

// Tail returns the most recent entries across all requests, newest last.
func (s *LogService) Tail(minLevel slog.Level, limit int) []logring.Entry {
	return s.ring.Tail(logring.Query{MinLevel: minLevel, Limit: limit})
}

func parseLevelParam(s string) (slog.Level, error) {
	if s == "" {
		return slog.LevelDebug, nil // keep everything by default
	}
	switch s {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	}
	return 0, ErrValidation
}

// handleLogs serves GET /dev/logs?request_id=&level=&limit=
func (d *Deps) handleLogs(w http.ResponseWriter, r *http.Request) {
	if !d.Logs.Available() {
		webx.ErrNotFound(w, "log capture not enabled (logring not wired)")
		return
	}
	level, err := parseLevelParam(r.URL.Query().Get("level"))
	if err != nil {
		webx.ErrValidation(w, "invalid level (debug|info|warn|error)")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rid := r.URL.Query().Get("request_id")
	var entries []logring.Entry
	if rid != "" {
		entries = d.Logs.ByRequestID(rid, level, limit)
	} else {
		entries = d.Logs.Tail(level, limit)
	}
	if entries == nil {
		entries = []logring.Entry{}
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"request_id": rid, "entries": entries})
}
