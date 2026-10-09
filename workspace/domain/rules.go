package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"time"
)

const (
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleMember = "member"
)

func AssignableRole(role string) bool { return role == RoleAdmin || role == RoleMember }

type RoleAction int

const (
	ActionDemote RoleAction = iota + 1
	ActionRemove
	ActionPromote
)

func LastOwnerProtected(targetRole string, targetIsLastOwner bool, action RoleAction) bool {
	if targetRole == RoleOwner && targetIsLastOwner {
		switch action {
		case ActionDemote, ActionRemove:
			return true
		}
	}
	return false
}

func CanLeave(role string, isLastOwner bool) bool {
	return !(role == RoleOwner && isLastOwner)
}

const (
	InviteTTL    = 7 * 24 * time.Hour
	ShareCodeLen = 24
)

func InviteExpiry(now time.Time) time.Time { return now.Add(InviteTTL) }

func MintShareCode() (string, error) {
	b := make([]byte, ShareCodeLen/2)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func HashShareCode(code string) string {
	h := sha256.Sum256([]byte("ploykit-share:" + code))
	return hex.EncodeToString(h[:])
}

func ShareCodeOK(code string) bool {
	if len(code) != ShareCodeLen {
		return false
	}
	_, err := hex.DecodeString(code)
	return err == nil
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$`)

func SlugOK(slug string) bool { return slugRe.MatchString(slug) }

var ReservedSlugs = map[string]bool{
	"api": true, "www": true, "app": true, "admin": true, "mail": true,
	"static": true, "assets": true, "auth": true, "support": true, "billing": true,
}

func SlugReserved(slug string) bool { return ReservedSlugs[strings.ToLower(slug)] }

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func EmailOK(email string) bool {
	e := strings.ToLower(strings.TrimSpace(email))
	return len(e) <= 254 && emailRe.MatchString(e)
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
