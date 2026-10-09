package app

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory  = 19456
	argonTime    = 2
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

var phcRe = regexp.MustCompile(`^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$`)

func HashPassword(password string) (string, error) {
	salt := randomBytes(argonSaltLen)
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64Raw(salt), base64Raw(key)), nil
}

var dummyPHC = sync.OnceValue(func() string {
	h, _ := HashPassword("ploykit-dummy-timing-equalizer")
	return h
})

func VerifyPassword(password, phc string) bool {
	m := phcRe.FindStringSubmatch(phc)
	if m == nil {
		return false
	}
	t, _ := strconv.Atoi(m[3])
	mem, _ := strconv.Atoi(m[2])
	p, _ := strconv.Atoi(m[4])
	salt, err := fromBase64Raw(m[5])
	if err != nil {
		return false
	}
	want, err := fromBase64Raw(m[6])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, uint32(t), uint32(mem), uint8(p), uint32(len(want)))
	return constantTimeEq(got, want)
}

func base64Raw(b []byte) string { return strings.TrimRight(base64Encode(b), "=") }
func fromBase64Raw(s string) ([]byte, error) {
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}
	return base64Decode(s)
}
