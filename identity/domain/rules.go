package domain

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	CodeLength     = 6
	CodeTTL        = 10 * time.Minute
	CodeMaxTries   = 5
	ResendCooldown = time.Minute
)

func CodeExpiry(now time.Time) time.Time { return now.Add(CodeTTL) }

func digitFromByte(b byte) (byte, bool) {
	if b >= 250 {
		return 0, false
	}
	return '0' + b%10, true
}

func IssueCode() (string, error) {
	out := make([]byte, CodeLength)
	for i := range out {
		for {
			var b [1]byte
			if _, err := rand.Read(b[:]); err != nil {
				return "", err
			}
			if d, ok := digitFromByte(b[0]); ok {
				out[i] = d
				break
			}
		}
	}
	return string(out), nil
}

func HashSecret(pepper, value string) string {
	m := hmac.New(sha256.New, []byte(pepper))
	m.Write([]byte(value))
	return hex.EncodeToString(m.Sum(nil))
}

func CodeOK(code string) bool {
	if len(code) != CodeLength {
		return false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

const (
	ResetLinkTTL  = time.Hour
	VerifyLinkTTL = 24 * time.Hour
)

func MintLinkToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

const DefaultPATPrefix = "tk_"

func MintPAT(prefix string) (token, hash, display string, err error) {
	if prefix == "" {
		prefix = DefaultPATPrefix
	}
	b := make([]byte, 20)
	if _, err = rand.Read(b); err != nil {
		return "", "", "", err
	}
	token = prefix + hex.EncodeToString(b)
	return token, HashPAT(token), token[:8], nil
}

func HashPAT(token string) string {
	h := sha256.Sum256([]byte("tk-pat:" + token))
	return hex.EncodeToString(h[:])
}

func IsPATFormat(prefix, token string) bool {
	if prefix == "" {
		prefix = DefaultPATPrefix
	}
	if !strings.HasPrefix(token, prefix) {
		return false
	}
	rest := token[len(prefix):]
	if len(rest) != 40 {
		return false
	}
	_, err := hex.DecodeString(rest)
	return err == nil
}

func SignupAllowed(email string, allowedEmails, allowedDomains []string) bool {
	if len(allowedEmails) == 0 && len(allowedDomains) == 0 {
		return true
	}
	return EmailWhitelisted(email, allowedEmails, allowedDomains)
}

func EmailWhitelisted(email string, allowedEmails, allowedDomains []string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, e := range allowedEmails {
		if strings.EqualFold(strings.TrimSpace(e), email) {
			return true
		}
	}
	at := strings.LastIndex(email, "@")
	if at < 0 {
		return false
	}
	domain := email[at+1:]
	for _, d := range allowedDomains {
		d = strings.ToLower(strings.TrimSpace(d))
		if d == domain || (strings.HasPrefix(d, ".") && strings.HasSuffix(domain, d)) {
			return true
		}
	}
	return false
}

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func EmailOK(email string) bool {
	e := strings.ToLower(strings.TrimSpace(email))
	return len(e) <= 254 && emailRe.MatchString(e)
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$`)

func SlugOK(slug string) bool { return slugRe.MatchString(slug) }

var ReservedSlugs = map[string]bool{
	"api": true, "www": true, "app": true, "admin": true, "mail": true,
	"static": true, "assets": true, "auth": true, "support": true, "billing": true,
}

func SlugReserved(slug string) bool { return ReservedSlugs[strings.ToLower(slug)] }

func PasswordOK(pw string) bool {
	if len(pw) < 10 || len(pw) > 128 {
		return false
	}
	var hasDigit, hasLower, hasUpper, hasSymbol bool
	for _, c := range pw {
		switch {
		case c >= '0' && c <= '9':
			hasDigit = true
		case c >= 'a' && c <= 'z':
			hasLower = true
		case c >= 'A' && c <= 'Z':
			hasUpper = true
		default:
			hasSymbol = true
		}
	}
	kinds := 0
	for _, b := range []bool{hasDigit, hasLower, hasUpper, hasSymbol} {
		if b {
			kinds++
		}
	}
	return kinds >= 3
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func UUIDOK(s string) bool { return uuidRe.MatchString(s) }

const DisplayNameMaxLen = 100

func NormalizeDisplayName(raw string) (string, bool) {
	t := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(t)
	return t, n >= 1 && n <= DisplayNameMaxLen
}

const AvatarURLMaxLen = 2048

func AvatarURLOK(raw string) bool {
	v := strings.TrimSpace(raw)
	if v == "" {
		return true
	}
	return (strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://")) && len(v) <= AvatarURLMaxLen
}
