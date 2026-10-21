package webx

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

type Error struct {
	Status  int
	Code    string
	Message string
	// RetryAfter, when non-zero, is emitted as the standard `Retry-After`
	// header by WriteErr and mirrored into the JSON body. Rate-limit errors
	// set it so clients can wait the right amount instead of guessing (a bare
	// 429 carrying only prose is the shape that produces blind retry storms
	// and "how long do I wait?" support tickets).
	RetryAfter time.Duration
}

func (e *Error) Error() string { return e.Message }

func NewError(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

func NewValidation(msg string) *Error      { return NewError(400, CodeValidation, msg) }
func NewUnauthenticated(msg string) *Error { return NewError(401, CodeUnauthenticated, msg) }
func NewForbidden(msg string) *Error       { return NewError(403, CodeForbidden, msg) }
func NewNotFound(msg string) *Error        { return NewError(404, CodeNotFound, msg) }
func NewConflict(msg string) *Error        { return NewError(409, CodeConflict, msg) }
func NewRateLimited(msg string) *Error     { return NewError(429, CodeRateLimited, msg) }
func NewQuotaExceeded(msg string) *Error   { return NewError(402, CodeQuotaExceeded, msg) }

// NewRateLimitedRetry is NewRateLimited plus the wait hint. The response then
// carries `Retry-After` (whole seconds, rounded up) AND the same value in the
// JSON body as details.retry_after_seconds — the body copy exists because
// browser JS cannot read response headers on a cross-origin request without
// explicit CORS exposure, and the body is always readable.
func NewRateLimitedRetry(msg string, after time.Duration) *Error {
	e := NewRateLimited(msg)
	if after > 0 {
		e.RetryAfter = after
	}
	return e
}

// WriteErr writes the canonical error body, plus the retry metadata when the
// error carries a RetryAfter hint.
func WriteErr(w http.ResponseWriter, err error) {
	var we *Error
	if errors.As(err, &we) {
		var details any
		if we.RetryAfter > 0 {
			secs := int(we.RetryAfter.Seconds())
			if secs < 1 {
				secs = 1 // sub-second waits round up; "Retry-After: 0" reads as "retry now"
			}
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			details = map[string]any{"retry_after_seconds": secs}
		}
		WriteError(w, we.Status, we.Code, we.Message, details)
		return
	}
	slog.Error("internal error (unmapped)", "err", err)
	ErrInternal(w)
}
