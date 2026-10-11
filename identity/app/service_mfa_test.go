package app

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/haozing/ploykit/platform/webx"
)

// fakeMFARepo is the in-memory MFARepo; sealing is passthrough so tests read
// secrets directly.
type fakeMFARepo struct {
	mu          sync.Mutex
	secret      string
	confirmedAt *time.Time
	backupCodes map[string]bool // hash → consumed
}

func (f *fakeMFARepo) UpsertPendingMFA(_ context.Context, userID, secretSealed string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.secret = secretSealed
	f.confirmedAt = nil
	return nil
}

func (f *fakeMFARepo) GetMFA(_ context.Context, _ string) (string, *time.Time, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.secret == "" {
		return "", nil, false, nil
	}
	return f.secret, f.confirmedAt, true, nil
}

func (f *fakeMFARepo) ConfirmMFA(_ context.Context, _ string, now time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.secret == "" || f.confirmedAt != nil {
		return ErrNotFound
	}
	f.confirmedAt = &now
	return nil
}

func (f *fakeMFARepo) DeleteMFA(_ context.Context, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.secret = ""
	f.confirmedAt = nil
	f.backupCodes = nil
	return nil
}

func (f *fakeMFARepo) ReplaceBackupCodes(_ context.Context, _ string, hashes []string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.backupCodes = make(map[string]bool, len(hashes))
	for _, h := range hashes {
		f.backupCodes[h] = false
	}
	return nil
}

func (f *fakeMFARepo) ConsumeBackupCode(_ context.Context, _ string, codeHash string, _ time.Time) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	consumed, ok := f.backupCodes[codeHash]
	if !ok || consumed {
		return false, nil
	}
	f.backupCodes[codeHash] = true
	return true, nil
}

func (f *fakeMFARepo) ConfirmSessionMFA(_ context.Context, _ string, _ time.Time) error { return nil }

// passthroughSecrets satisfies app.Secrets without real sealing.
type passthroughSecrets struct{}

func (passthroughSecrets) Seal(plain string) (string, error) { return "sealed:" + plain, nil }
func (passthroughSecrets) Unseal(stored string) (string, error) {
	return strings.TrimPrefix(stored, "sealed:"), nil
}

// fakeSessionRepo carries just the limiter surface SessionService touches;
// the embedded nil interface panics on anything else (a tripwire).
type fakeSessionRepo struct {
	Repo
	attempts int
}

func (f *fakeSessionRepo) CountRecentAttempts(context.Context, string, string, time.Time) (int, error) {
	return f.attempts, nil
}
func (f *fakeSessionRepo) RecordAttempt(context.Context, string, string, bool, time.Time) error {
	return nil
}
func (f *fakeSessionRepo) RevokeAllUserSessions(context.Context, string) error { return nil }

func newMFATestService(t *testing.T, repo MFARepo) *MFAService {
	t.Helper()
	base := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	sessions := NewSessionService(&fakeSessionRepo{}, nil, SessionConfig{}, time.Hour, 2*time.Hour, func() time.Time { return base })
	return NewMFAService(repo, sessions, passthroughSecrets{}, "ploykit-test", func() time.Time { return base })
}

func mfaTestPrincipal() *webx.Principal {
	return &webx.Principal{
		UserID: "user-1", Email: "user@example.test", Source: webx.SourceSession,
		SessionID: "session-1",
	}
}

func TestMFAEnrollEnableVerifyDisableCycle(t *testing.T) {
	repo := &fakeMFARepo{}
	svc := newMFATestService(t, repo)
	ctx := context.Background()
	p := mfaTestPrincipal()

	// enroll → pending, otpauth URI carries the secret and issuer
	enrollment, err := svc.StartEnrollment(ctx, p, p.Email)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(enrollment.OTPAuthURI, "otpauth://totp/ploykit-test:user@example.test") ||
		!strings.Contains(enrollment.OTPAuthURI, "secret="+enrollment.Secret) {
		t.Fatalf("enrollment URI malformed: %s", enrollment.OTPAuthURI)
	}

	// enable with a wrong code fails; session not stamped
	if _, err := svc.Enable(ctx, "ip", p, "000000"); err == nil {
		t.Fatal("enable with wrong code must fail")
	}

	// enable with the right code returns backup codes and confirms
	secret, err := ParseTOTPBase32(enrollment.Secret)
	if err != nil {
		t.Fatal(err)
	}
	code := totpAt(secret, uint64(svc.now().Unix()/30))
	codes, err := svc.Enable(ctx, "ip", p, code)
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 10 {
		t.Fatalf("backup codes = %d, want 10", len(codes))
	}
	if enabled, _ := svc.Enabled(ctx, p.UserID); !enabled {
		t.Fatal("enrollment must be confirmed after enable")
	}

	// backup codes consume once — normalized input (case/hyphen) accepted
	if ok, _ := repo.ConsumeBackupCode(ctx, p.UserID, hashBackupCode(codes[0]), svc.now()); !ok {
		t.Fatal("first use of a backup code must consume")
	}
	if ok, _ := repo.ConsumeBackupCode(ctx, p.UserID, hashBackupCode(codes[0]), svc.now()); ok {
		t.Fatal("backup code must be single-use")
	}
	lower := strings.ToLower(strings.ReplaceAll(codes[1], "-", " "))
	if ok, _ := repo.ConsumeBackupCode(ctx, p.UserID, hashBackupCode(lower), svc.now()); !ok {
		t.Fatal("case-insensitive, hyphen-optional entry must consume")
	}

	// verify-mfa with a fresh TOTP stamps
	now2 := svc.now().Add(45 * time.Second)
	svc.now = func() time.Time { return now2 }
	stamp, err := svc.VerifyMFA(ctx, "ip", p, totpAt(secret, uint64(now2.Unix()/30)))
	if err != nil {
		t.Fatal(err)
	}
	if !stamp.Equal(now2) {
		t.Fatalf("stamp = %s, want %s", stamp, now2)
	}

	// re-enroll while enabled is refused
	if _, err := svc.StartEnrollment(ctx, p, p.Email); err != ErrMFAAlreadyEnabled {
		t.Fatalf("re-enroll = %v, want ErrMFAAlreadyEnabled", err)
	}

	// disable clears everything
	if err := svc.Disable(ctx, p); err != nil {
		t.Fatal(err)
	}
	if enabled, _ := svc.Enabled(ctx, p.UserID); enabled {
		t.Fatal("disable must clear the enrollment")
	}
}

func TestMFAVerifyFallsBackToBackupCode(t *testing.T) {
	repo := &fakeMFARepo{}
	svc := newMFATestService(t, repo)
	ctx := context.Background()
	p := mfaTestPrincipal()

	enrollment, err := svc.StartEnrollment(ctx, p, p.Email)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := ParseTOTPBase32(enrollment.Secret)
	if err != nil {
		t.Fatal(err)
	}
	codes, err := svc.Enable(ctx, "ip", p, totpAt(secret, uint64(svc.now().Unix()/30)))
	if err != nil {
		t.Fatal(err)
	}

	// TOTP deliberately wrong → backup code path stamps
	stamp, err := svc.VerifyMFA(ctx, "ip", p, codes[2])
	if err != nil {
		t.Fatal(err)
	}
	if stamp.IsZero() {
		t.Fatal("backup-code verify must stamp")
	}
	// the same code is spent
	if _, err := svc.VerifyMFA(ctx, "ip", p, codes[2]); err == nil {
		t.Fatal("spent backup code must not verify twice")
	}
}

func TestMFAVerifyWithoutEnrollmentDenied(t *testing.T) {
	svc := newMFATestService(t, &fakeMFARepo{})
	if _, err := svc.VerifyMFA(context.Background(), "ip", mfaTestPrincipal(), "123456"); err != ErrMFANotEnrolled {
		t.Fatalf("verify without enrollment = %v, want ErrMFANotEnrolled", err)
	}
}

func TestMFAEnrollRequiresSecrets(t *testing.T) {
	svc := newMFATestService(t, &fakeMFARepo{})
	svc.secrets = nil
	if _, err := svc.StartEnrollment(context.Background(), mfaTestPrincipal(), "x@y.z"); err != ErrMFASealUnavailable {
		t.Fatalf("enroll without seal key = %v, want ErrMFASealUnavailable", err)
	}
}

func TestBackupCodeShape(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		code, err := generateBackupCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != 11 || code[5] != '-' {
			t.Fatalf("code shape broken: %q", code)
		}
		for _, r := range code {
			if r != '-' && !strings.ContainsRune(backupCodeAlphabet, r) {
				t.Fatalf("code contains %q outside the unambiguous alphabet: %q", r, code)
			}
		}
		if seen[code] {
			t.Fatalf("duplicate code generated: %s", code)
		}
		seen[code] = true
	}
}
