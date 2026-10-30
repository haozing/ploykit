package webx

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"sort"
	"strings"
)

type ErrorBody struct {
	Code    string `json:"error"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func WriteError(w http.ResponseWriter, status int, code, message string, details any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorBody{Code: code, Message: message, Details: details})
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			WriteError(w, http.StatusRequestEntityTooLarge, CodePayloadTooLarge, "request body too large", err.Error())
			return false
		}
		WriteError(w, http.StatusBadRequest, "E_BAD_JSON", "invalid request body", err.Error())
		return false
	}
	if dec.More() {
		WriteError(w, http.StatusBadRequest, "E_BAD_JSON", "invalid request body", "trailing data")
		return false
	}
	return true
}

// DecodeJSONKnown is the evolution-friendly counterpart of DecodeJSON
// (aifengkong #3): valid JSON is decoded into dst leniently — type mismatches
// still fail with 400 — but UNKNOWN field names are captured into the
// returned slice instead of rejected, so a handler can accept a client that
// started sending extra data (shadow-field rollout) while still seeing
// exactly what it ignored. Handlers wanting unknown = 400 keep DecodeJSON.
func DecodeJSONKnown(w http.ResponseWriter, r *http.Request, dst any) (unknown []string, ok bool) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			WriteError(w, http.StatusRequestEntityTooLarge, CodePayloadTooLarge, "request body too large", err.Error())
			return nil, false
		}
		WriteError(w, http.StatusBadRequest, "E_BAD_JSON", "invalid request body", err.Error())
		return nil, false
	}

	strict := json.NewDecoder(bytes.NewReader(body))
	if err := strict.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			WriteError(w, http.StatusRequestEntityTooLarge, CodePayloadTooLarge, "request body too large", err.Error())
			return nil, false
		}
		WriteError(w, http.StatusBadRequest, "E_BAD_JSON", "invalid request body", err.Error())
		return nil, false
	}
	if strict.More() {
		WriteError(w, http.StatusBadRequest, "E_BAD_JSON", "invalid request body", "trailing data")
		return nil, false
	}

	var probe map[string]json.RawMessage
	if err := json.Unmarshal(body, &probe); err != nil {
		WriteError(w, http.StatusBadRequest, "E_BAD_JSON", "invalid request body", err.Error())
		return nil, false
	}
	known := map[string]struct{}{}
	if dst != nil {
		t := reflect.TypeOf(dst)
		if t.Kind() == reflect.Pointer {
			t = t.Elem()
		}
		if t.Kind() == reflect.Struct {
			for _, f := range reflect.VisibleFields(t) {
				name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
				if name == "" {
					name = f.Name
				}
				if name != "-" {
					known[name] = struct{}{}
				}
			}
		}
	}
	for k := range probe {
		if _, ok := known[k]; !ok {
			unknown = append(unknown, k)
		}
	}
	sort.Strings(unknown)
	return unknown, true
}

const (
	CodeUnauthenticated = "E_UNAUTHENTICATED"
	CodeForbidden       = "E_FORBIDDEN"
	CodeNotFound        = "E_NOT_FOUND"
	CodeValidation      = "E_VALIDATION"
	CodeConflict        = "E_CONFLICT"
	CodeRateLimited     = "E_RATE_LIMITED"
	CodeQuotaExceeded   = "E_QUOTA_EXCEEDED"
	CodeInternal        = "E_INTERNAL"
	CodeTimeout         = "E_TIMEOUT"
	CodePayloadTooLarge = "E_PAYLOAD_TOO_LARGE"
	CodeUnavailable     = "E_UNAVAILABLE"

	// CodeReauthRequired is the step-up challenge (RequireRecentAuth): the
	// caller is authenticated but the password confirmation is stale — confirm
	// via POST /auth/confirm-password, then retry. 403, never 401.
	CodeReauthRequired = "E_REAUTH_REQUIRED"

	// CodeAuthTransportConflict rejects mixed-transport requests (session
	// cookie AND bearer credential on one request — or an ambiguous duplicate
	// of either): which credential authenticated and which transport the
	// gates inspected must never diverge (GitLab #22435 class). 401, and
	// logged as a security signal, never silently disambiguated.
	CodeAuthTransportConflict = "E_AUTH_TRANSPORT_CONFLICT"

	// CodeTurnstile is the human-verification rejection (the Turnstile
	// middleware): the request carried no X-Turnstile-Token, or Cloudflare
	// siteverify answered success=false. 400; the client re-runs the
	// challenge and retries. Only ever produced while the middleware is
	// ENABLED — a CF-side outage fails open (log.Error), never as this code.
	CodeTurnstile = "E_TURNSTILE"
)

func ErrUnauthenticated(w http.ResponseWriter, msg string) {
	WriteError(w, http.StatusUnauthorized, CodeUnauthenticated, msg, nil)
}
func ErrForbidden(w http.ResponseWriter, msg string) {
	WriteError(w, http.StatusForbidden, CodeForbidden, msg, nil)
}
func ErrNotFound(w http.ResponseWriter, msg string) {
	WriteError(w, http.StatusNotFound, CodeNotFound, msg, nil)
}
func ErrValidation(w http.ResponseWriter, msg string) {
	WriteError(w, http.StatusBadRequest, CodeValidation, msg, nil)
}
func ErrConflict(w http.ResponseWriter, msg string) {
	WriteError(w, http.StatusConflict, CodeConflict, msg, nil)
}
func ErrInternal(w http.ResponseWriter) {
	WriteError(w, http.StatusInternalServerError, CodeInternal, "internal error", nil)
}
func ErrTimeout(w http.ResponseWriter) {
	WriteError(w, http.StatusGatewayTimeout, CodeTimeout, "request timeout", nil)
}
func ErrPayloadTooLarge(w http.ResponseWriter, msg string) {
	WriteError(w, http.StatusRequestEntityTooLarge, CodePayloadTooLarge, msg, nil)
}
func ErrUnavailable(w http.ResponseWriter, msg string) {
	WriteError(w, http.StatusServiceUnavailable, CodeUnavailable, msg, nil)
}
