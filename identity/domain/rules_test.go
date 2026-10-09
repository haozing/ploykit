package domain

import (
	"testing"
)

func TestCodeFormat(t *testing.T) {
	code, err := IssueCode()
	if err != nil || !CodeOK(code) {
		t.Fatalf("IssueCode -> %q err=%v", code, err)
	}
	if CodeOK("12345") || CodeOK("12345a") || CodeOK("1234567") {
		t.Error("CodeOK accepted malformed codes")
	}
}

func TestIssueCodeDigitRejectionSampling_I10(t *testing.T) {
	counts := make([]int, 10)
	for b := 0; b < 256; b++ {
		d, ok := digitFromByte(byte(b))
		if b >= 250 {
			if ok {
				t.Fatalf("byte %d (>=250) 必须被拒绝重取", b)
			}
			continue
		}
		if !ok {
			t.Fatalf("byte %d (<250) 必须被接受", b)
		}
		if d < '0' || d > '9' {
			t.Fatalf("派生值 %d 不在 '0'..'9'", d)
		}
		counts[d-'0']++
	}
	for d, n := range counts {
		if n != 25 {
			t.Errorf("数字 %d 接受 %d 个字节值，want 恰好 25（均匀分布）", d, n)
		}
	}

	code, err := IssueCode()
	if err != nil || !CodeOK(code) {
		t.Fatalf("IssueCode -> %q err=%v", code, err)
	}
}

func TestHashSecretIsPeppered(t *testing.T) {
	a := HashSecret("pepper-a", "123456")
	b := HashSecret("pepper-b", "123456")
	if a == b {
		t.Error("hash must depend on pepper")
	}
	if HashSecret("p", "123456") != HashSecret("p", "123456") {
		t.Error("hash must be deterministic")
	}
}

func TestPATFormat(t *testing.T) {
	token, _, _, err := MintPAT("")
	if err != nil || !IsPATFormat("", token) {
		t.Fatalf("MintPAT -> %q err=%v", token, err)
	}
	if IsPATFormat("", "tk_short") || IsPATFormat("", "xx_"+token[3:]) {
		t.Error("IsPATFormat accepted malformed tokens")
	}
}

func TestMintPATCustomPrefix(t *testing.T) {
	token, hash, display, err := MintPAT("ork_")
	if err != nil {
		t.Fatal(err)
	}
	if !IsPATFormat("ork_", token) {
		t.Fatalf("自定义前缀令牌应过同前缀闸门: %q", token)
	}
	if len(token) != len("ork_")+40 {
		t.Errorf("令牌长度 %d, want %d", len(token), len("ork_")+40)
	}
	if display != token[:8] {
		t.Errorf("展示前缀应取令牌前 8 位: %q vs %q", display, token[:8])
	}
	if hash != HashPAT(token) {
		t.Error("hash 应为明文的 HashPAT")
	}

	if IsPATFormat("", token) {
		t.Error("default-prefix gate must reject custom-prefix token")
	}

	defToken, _, _, _ := MintPAT("")
	if !IsPATFormat("", defToken) || !IsPATFormat("tk_", defToken) {
		t.Errorf("空前缀应回退默认 tk_: %q", defToken)
	}
}

func TestSignupWhitelist(t *testing.T) {

	if !SignupAllowed("anyone@example.com", nil, nil) {
		t.Error("empty whitelist must allow open signup")
	}
	emails := []string{"boss@corp.com"}
	domains := []string{"corp.com", ".edu.cn"}
	if !SignupAllowed("boss@corp.com", emails, domains) {
		t.Error("exact email should pass")
	}
	if !SignupAllowed("new@sub.corp.com", emails, []string{".corp.com"}) {
		t.Error("dot-prefixed domain suffix should pass")
	}
	if !SignupAllowed("a@b.edu.cn", emails, domains) {
		t.Error("dot-prefixed domain should pass")
	}
	if SignupAllowed("new@sub.corp.com", emails, domains) {
		t.Error("sub-domain of an exact-domain entry must not pass")
	}
	if SignupAllowed("stranger@evil.com", emails, domains) {
		t.Error("outsider must be rejected")
	}
}

func TestPasswordStrength(t *testing.T) {
	if PasswordOK("short1A") {
		t.Error("too short accepted")
	}
	if PasswordOK("alllowercase1") {
		t.Error("two kinds accepted")
	}
	if !PasswordOK("Reasonable-Passw0rd") {
		t.Error("strong password rejected")
	}
}
