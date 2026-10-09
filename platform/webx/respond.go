package webx

import (
	"encoding/json"
	"errors"
	"net/http"
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
