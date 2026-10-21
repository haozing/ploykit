package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

// ErrMFANotEnrolled and ErrMFAAlreadyConfirmed are the flow-level MFA states
// handlers translate into webx error envelopes.
var (
	ErrMFANotEnrolled     = errors.New("identity: mfa not enrolled")
	ErrMFAAlreadyEnabled  = errors.New("identity: mfa already enabled")
	ErrMFAPendingNotReady = errors.New("identity: mfa enrollment pending confirmation")
	ErrMFASealUnavailable = errors.New("identity: seal key not configured; mfa secrets must be stored sealed")
)

// MFARepo is the persistence seam of the TOTP + backup-code flows (ADR 0013
// batch 2). Deliberately separate from Repo: identity consumers that never
// mount MFA keep their existing fakes intact.
type MFARepo interface {
	// UpsertPendingMFA stores a freshly generated (sealed) secret for the
	// user, replacing any previous enrollment — pending or confirmed. Callers
	// must refuse to overwrite a confirmed enrollment (re-enrollment goes
	// through disable first).
	UpsertPendingMFA(ctx context.Context, userID, secretSealed string, now time.Time) error

	// GetMFA returns the sealed secret and the confirmation stamp;
	// ok=false when the user has no enrollment row.
	GetMFA(ctx context.Context, userID string) (secretSealed string, confirmedAt *time.Time, ok bool, err error)

	// ConfirmMFA stamps confirmed_at (the enroll→enable transition).
	ConfirmMFA(ctx context.Context, userID string, now time.Time) error

	// DeleteMFA removes the enrollment and all backup codes (disable).
	DeleteMFA(ctx context.Context, userID string) error

	// ReplaceBackupCodes swaps the pending backup-code set (regenerate, and
	// the initial set at enable time).
	ReplaceBackupCodes(ctx context.Context, userID string, codeHashes []string, now time.Time) error

	// ConsumeBackupCode marks one pending code consumed; ok=false when no
	// pending code matches the hash. Single UPDATE — consume-once is atomic.
	ConsumeBackupCode(ctx context.Context, userID, codeHash string, now time.Time) (ok bool, err error)

	// ConfirmSessionMFA stamps mfa_confirmed_at on a live session (the
	// step-up / born-confirmed stamp对称列 of ConfirmSessionPassword).
	ConfirmSessionMFA(ctx context.Context, sessionID string, now time.Time) error
}

// MFAService implements the TOTP + backup-code flows: enroll (start) / enable
// (verify first code) / disable (step-up guarded at the mount site) /
// regenerate backup codes (ditto) / verify-mfa (the AAL2 step-up stamping
// endpoint). Secrets are sealed through the same Secrets seam as every other
// stored credential — with no seal key configured enrollment is refused
// (E_SEAL_KEY_MISSING), per the framework's tenant-credential constraint.
//
// Scope discipline (ADR 0013): strictly TOTP + backup codes — WebAuthn,
// recovery flows, and SMS are not here; login-integrated MFA (a challenge
// inside the login flow) is the next consumer's step.
type MFAService struct {
	repo     MFARepo
	sessions *SessionService // reuses the login attempt limiter family
	secrets  Secrets
	issuer   string
	now      Clock
}

func NewMFAService(repo MFARepo, sessions *SessionService, secrets Secrets, issuer string, now Clock) *MFAService {
	return &MFAService{repo: repo, sessions: sessions, secrets: secrets, issuer: issuer, now: now}
}

// Enrollment is the enroll-start payload: the otpauth:// URI (the QR payload)
// plus the base32 secret for manual entry. The secret is returned exactly
// once — only the sealed form is stored.
type Enrollment struct {
	OTPAuthURI string `json:"otpauth_uri"`
	Secret     string `json:"secret"`
	Issuer     string `json:"issuer"`
}

// StartEnrollment generates and stores a pending (unconfirmed) TOTP secret.
// Re-enrollment while an enrollment is already confirmed is refused —
// disable first (the GitHub-shaped flow; keeps a hijacked session from
// silently swapping a victim's factor).
func (s *MFAService) StartEnrollment(ctx context.Context, p *webx.Principal, accountEmail string) (Enrollment, error) {
	_, confirmedAt, ok, err := s.repo.GetMFA(ctx, p.UserID)
	if err != nil {
		return Enrollment{}, err
	}
	if ok && confirmedAt != nil {
		return Enrollment{}, ErrMFAAlreadyEnabled
	}
	if s.secrets == nil {
		return Enrollment{}, ErrMFASealUnavailable
	}
	secret, err := GenerateTOTPSecret()
	if err != nil {
		return Enrollment{}, err
	}
	sealed, err := s.secrets.Seal(TOTPBase32(secret))
	if err != nil {
		return Enrollment{}, err
	}
	if err := s.repo.UpsertPendingMFA(ctx, p.UserID, sealed, s.now()); err != nil {
		return Enrollment{}, err
	}
	secretB32 := TOTPBase32(secret)
	return Enrollment{
		OTPAuthURI: OTPAuthURI(s.issuer, accountEmail, secretB32),
		Secret:     secretB32,
		Issuer:     s.issuer,
	}, nil
}

// Enabled reports whether the user has a confirmed enrollment.
func (s *MFAService) Enabled(ctx context.Context, userID string) (bool, error) {
	_, confirmedAt, ok, err := s.repo.GetMFA(ctx, userID)
	if err != nil {
		return false, err
	}
	return ok && confirmedAt != nil, nil
}

// Status is the settings-page view: enabled (confirmed enrollment) and
// pending (enrollment started, first code not yet verified).
func (s *MFAService) Status(ctx context.Context, userID string) (enabled, pending bool, err error) {
	_, confirmedAt, ok, err := s.repo.GetMFA(ctx, userID)
	if err != nil {
		return false, false, err
	}
	return ok && confirmedAt != nil, ok && confirmedAt == nil, nil
}

// Enable verifies the first code against the pending secret, confirms the
// enrollment, issues the initial backup-code set (returned once), and stamps
// the current session — completing the proof this very code constitutes.
func (s *MFAService) Enable(ctx context.Context, ipHash string, p *webx.Principal, code string) ([]string, error) {
	sealed, confirmedAt, ok, err := s.repo.GetMFA(ctx, p.UserID)
	if err != nil {
		return nil, err
	}
	if !ok || confirmedAt != nil {
		return nil, ErrMFANotEnrolled
	}
	secret, err := s.unseal(sealed)
	if err != nil {
		return nil, err
	}
	if err := s.limit(ctx, ipHash, p); err != nil {
		return nil, err
	}
	if !VerifyTOTP(secret, code, s.now()) {
		s.recordFailure(ctx, ipHash, p)
		return nil, webx.NewUnauthenticated("invalid code")
	}
	now := s.now()
	if err := s.repo.ConfirmMFA(ctx, p.UserID, now); err != nil {
		return nil, err
	}
	codes, err := s.replaceBackupCodes(ctx, p.UserID)
	if err != nil {
		return nil, err
	}
	if p.SessionID != "" {
		if err := s.repo.ConfirmSessionMFA(ctx, p.SessionID, now); err != nil {
			return nil, err
		}
	}
	return codes, nil
}

// Disable removes the enrollment and every backup code. It is mount-site
// step-up guarded (MFAChangeGuard in identityhttp.Deps) — mirroring GitHub's
// sudo-guarded 2FA settings — and it revokes all the user's sessions so a
// device holding a stolen MFA-proofed session keeps nothing.
func (s *MFAService) Disable(ctx context.Context, p *webx.Principal) error {
	_, confirmedAt, ok, err := s.repo.GetMFA(ctx, p.UserID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrMFANotEnrolled
	}
	_ = confirmedAt // an unconfirmed pending row may also be discarded
	if err := s.repo.DeleteMFA(ctx, p.UserID); err != nil {
		return err
	}
	return s.sessions.repo.RevokeAllUserSessions(ctx, p.UserID)
}

// RegenerateBackupCodes swaps in a fresh backup-code set, returning the
// plaintext codes exactly once.
func (s *MFAService) RegenerateBackupCodes(ctx context.Context, p *webx.Principal) ([]string, error) {
	_, confirmedAt, ok, err := s.repo.GetMFA(ctx, p.UserID)
	if err != nil {
		return nil, err
	}
	if !ok || confirmedAt == nil {
		return nil, ErrMFANotEnrolled
	}
	return s.replaceBackupCodes(ctx, p.UserID)
}

// VerifyMFA is the AAL2 step-up stamp: verify a TOTP or a backup code, then
// stamp mfa_confirmed_at on the caller's session. Failed attempts go through
// the same attempt limiter as login and confirm-password, so a hijacked
// session cannot brute-force codes. Returns the stamp time.
func (s *MFAService) VerifyMFA(ctx context.Context, ipHash string, p *webx.Principal, code string) (time.Time, error) {
	sealed, confirmedAt, ok, err := s.repo.GetMFA(ctx, p.UserID)
	if err != nil {
		return time.Time{}, err
	}
	if !ok || confirmedAt == nil {
		return time.Time{}, ErrMFANotEnrolled
	}
	if err := s.limit(ctx, ipHash, p); err != nil {
		return time.Time{}, err
	}
	now := s.now()
	if s.verifyCode(ctx, p, sealed, code, now) {
		if err := s.repo.ConfirmSessionMFA(ctx, p.SessionID, now); err != nil {
			if errors.Is(err, ErrNotFound) {
				return time.Time{}, webx.NewUnauthenticated("session no longer valid")
			}
			return time.Time{}, err
		}
		return now, nil
	}
	s.recordFailure(ctx, ipHash, p)
	return time.Time{}, webx.NewUnauthenticated("invalid code")
}

// verifyCode tries a TOTP match first, then the single-use backup codes.
func (s *MFAService) verifyCode(ctx context.Context, p *webx.Principal, sealed, code string, now time.Time) bool {
	code = strings.TrimSpace(code)
	if code == "" {
		return false
	}
	if secret, err := s.unseal(sealed); err == nil && VerifyTOTP(secret, code, now) {
		return true
	}
	ok, err := s.repo.ConsumeBackupCode(ctx, p.UserID, hashBackupCode(code), now)
	return err == nil && ok
}

func (s *MFAService) recordFailure(ctx context.Context, ipHash string, p *webx.Principal) {
	_ = s.sessions.repo.RecordAttempt(ctx, ipHash, p.Email, false, s.sessions.now())
	s.sessions.fireLoginFailed(ctx, p.Email, ipHash)
}

func (s *MFAService) replaceBackupCodes(ctx context.Context, userID string) ([]string, error) {
	codes := make([]string, 10)
	hashes := make([]string, len(codes))
	for i := range codes {
		code, err := generateBackupCode()
		if err != nil {
			return nil, err
		}
		codes[i] = code
		hashes[i] = hashBackupCode(code)
	}
	if err := s.repo.ReplaceBackupCodes(ctx, userID, hashes, s.now()); err != nil {
		return nil, err
	}
	return codes, nil
}

func (s *MFAService) unseal(sealed string) ([]byte, error) {
	if s.secrets == nil {
		return nil, ErrMFASealUnavailable
	}
	plain, err := s.secrets.Unseal(sealed)
	if err != nil {
		return nil, err
	}
	secret, err := ParseTOTPBase32(plain)
	if err != nil {
		return nil, fmt.Errorf("identity: stored totp secret undecodable: %w", err)
	}
	return secret, nil
}

// limit shares the login attempt limiter with confirm-password: same table,
// same window — a hijacked session cannot brute-force MFA codes any more
// than it can brute-force the password.
func (s *MFAService) limit(ctx context.Context, ipHash string, p *webx.Principal) error {
	limited, err := s.sessions.tooManyAttempts(ctx, ipHash, p.Email)
	if err != nil {
		return err
	}
	if limited {
		return s.sessions.rateLimitedError(ctx, ipHash, p.Email)
	}
	return nil
}

// backupCodeAlphabet skips the visually ambiguous glyphs (0/O, 1/I/L) so a
// code read off paper survives transcription.
const backupCodeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

const backupCodeLen = 10

func generateBackupCode() (string, error) {
	raw := make([]byte, backupCodeLen)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate backup code: %w", err)
	}
	out := make([]byte, backupCodeLen)
	for i, b := range raw {
		out[i] = backupCodeAlphabet[int(b)%len(backupCodeAlphabet)]
	}
	// 12345-67890 grouping: 10 chars read better split in half
	return string(out[:5]) + "-" + string(out[5:]), nil
}

// hashBackupCode normalizes user input (case, hyphens, whitespace) before
// hashing — codes are case-insensitive and hyphen-optional at entry.
func hashBackupCode(input string) string {
	normalized := strings.ToUpper(strings.Map(func(r rune) rune {
		switch r {
		case ' ', '-', '\t':
			return -1
		}
		return r
	}, strings.TrimSpace(input)))
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}
