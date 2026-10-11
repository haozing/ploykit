package http

import (
	"errors"
	"net/http"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/platform/webx"
)

// This file carries the TOTP MFA flows (ADR 0013 batch 2): enroll → enable →
// verify-mfa (the AAL2 step-up stamp), plus disable / regenerate-backup-codes
// behind the product's MFAChangeGuard (step-up, mirroring GitHub's
// sudo-guarded 2FA settings). The routes mount only when Deps.MFA is wired —
// the capability exists when a seal key and an MFA repo exist.

// MountMFA registers the MFA routes. MFAChangeGuard (when set) wraps the
// settings-mutating routes — a product policy guard such as
// webx.RequireRecentAuth(15 * time.Minute).
func MountMFA(mux webx.Router, d Deps) {
	human := func(fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.HandlerFunc {
		return webx.RequireHuman(d.handle(fn))
	}
	guarded := func(fn func(w http.ResponseWriter, r *http.Request, p *webx.Principal)) http.Handler {
		var h http.Handler = human(fn)
		if d.MFAChangeGuard != nil {
			h = d.MFAChangeGuard(h)
		}
		return h
	}
	mux.HandleFunc("GET /auth/mfa/status", human(d.mfaStatus))
	mux.HandleFunc("POST /auth/mfa/enroll", human(d.mfaEnroll))
	mux.HandleFunc("POST /auth/mfa/enable", human(d.mfaEnable))
	mux.Handle("POST /auth/mfa/disable", guarded(d.mfaDisable))
	mux.Handle("POST /auth/mfa/regenerate-backup-codes", guarded(d.mfaRegenerate))
	mux.HandleFunc("POST /auth/verify-mfa", human(d.mfaVerify))
}

func (d Deps) mfaStatus(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	enabled, pending, err := d.MFA.Status(r.Context(), p.UserID)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"enabled": enabled,
		"pending": pending,
	})
}

func (d Deps) mfaEnroll(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	enrollment, err := d.MFA.StartEnrollment(r.Context(), p, p.Email)
	if err != nil {
		d.writeMFAErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, enrollment)
}

func (d Deps) mfaEnable(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Code string `json:"code"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	codes, err := d.MFA.Enable(r.Context(), d.ipHash(r), p, req.Code)
	if err != nil {
		d.writeMFAErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"backup_codes": codes})
}

func (d Deps) mfaDisable(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.MFA.Disable(r.Context(), p); err != nil {
		d.writeMFAErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"disabled": true})
}

func (d Deps) mfaRegenerate(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	codes, err := d.MFA.RegenerateBackupCodes(r.Context(), p)
	if err != nil {
		d.writeMFAErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"backup_codes": codes})
}

// mfaVerify is the AAL2 step-up stamping endpoint: POST /auth/verify-mfa with
// {code} — the second-factor twin of POST /auth/confirm-password. The client
// learns which one to call from the challenge's details.factor.
func (d Deps) mfaVerify(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Code string `json:"code"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	confirmedAt, err := d.MFA.VerifyMFA(r.Context(), d.ipHash(r), p, req.Code)
	if err != nil {
		d.writeMFAErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"mfa_confirmed_at": confirmedAt})
}

func (d Deps) writeMFAErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, app.ErrMFAAlreadyEnabled):
		webx.ErrConflict(w, "mfa already enabled; disable it before re-enrolling")
	case errors.Is(err, app.ErrMFANotEnrolled), errors.Is(err, app.ErrMFAPendingNotReady):
		webx.ErrValidation(w, "mfa is not enrolled (or enrollment not confirmed)")
	case errors.Is(err, app.ErrMFASealUnavailable):
		webx.WriteError(w, http.StatusInternalServerError, app.CodeSealKeyMissing,
			"seal key not configured (set PLOYKIT_SEAL_KEY); mfa secrets must be stored sealed", nil)
	default:
		webx.WriteErr(w, err)
	}
}
