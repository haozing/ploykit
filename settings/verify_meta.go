package settings

import (
	"fmt"
	"regexp"
	"strings"
)

// verificationMetaTagRe matches the exact paste form the search consoles
// (GSC/Bing) hand out: <meta name="…" content="…" /> — attribute order fixed,
// double quotes, optional self-closing slash. Anything else must come in as
// the bare `name|content` pair.
var verificationMetaTagRe = regexp.MustCompile(`(?i)^\s*<meta\s+name="([^"]+)"\s+content="([^"]*)"\s*/?>\s*$`)

// verificationCharset is a strict superset of the GSC/Bing content charset.
// Anything outside it — including < and > — is rejected, so no user-supplied
// HTML fragment ever survives validation (stored-XSS safety net: the value is
// injected into every HTML page, and only the server-recomposed tag built
// from the parsed pair may ever be rendered).
const verificationCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.:/+=-"

func verificationTokenOK(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !strings.ContainsRune(verificationCharset, r) {
			return false
		}
	}
	return true
}

// normalizeVerificationMeta converts accepted input into the stored
// `name|content` pair. ok=false means the input is neither accepted form;
// callers then keep the trimmed raw value and let Validate reject it.
// Empty input is valid ("not configured") and normalizes to "".
func normalizeVerificationMeta(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", true
	}
	if m := verificationMetaTagRe.FindStringSubmatch(raw); m != nil {
		return strings.TrimSpace(m[1]) + "|" + strings.TrimSpace(m[2]), true
	}
	if i := strings.IndexByte(raw, '|'); i >= 0 {
		return strings.TrimSpace(raw[:i]) + "|" + strings.TrimSpace(raw[i+1:]), true
	}
	return raw, false
}

func validateVerificationMeta(raw string) error {
	norm, ok := normalizeVerificationMeta(raw)
	if !ok {
		return fmt.Errorf("site_verification_meta 必须是完整的 <meta name=\"…\" content=\"…\"> 标签或 name|content 对")
	}
	if norm == "" {
		return nil // 空 = 未配置/清除
	}
	_, _, err := ParseVerificationMeta(norm)
	return err
}

// ParseVerificationMeta splits the stored normalized pair back into its parts
// and re-validates both. Products recompose the meta tag server-side
// (`<meta name="…" content="…">`) from this output — the stored user input is
// never reflected, only the recomposed tag is.
func ParseVerificationMeta(stored string) (name, content string, err error) {
	i := strings.IndexByte(stored, '|')
	if i < 0 {
		return "", "", fmt.Errorf("site_verification_meta 存储形态必须是 name|content 对")
	}
	name, content = stored[:i], stored[i+1:]
	if len(name) < 1 || len(name) > 64 {
		return "", "", fmt.Errorf("site_verification_meta 的 name 长度须在 1..64（当前 %d）", len(name))
	}
	if len(content) < 1 || len(content) > 256 {
		return "", "", fmt.Errorf("site_verification_meta 的 content 长度须在 1..256（当前 %d）", len(content))
	}
	if !verificationTokenOK(name) {
		return "", "", fmt.Errorf("site_verification_meta 的 name 含非法字符（仅允许字母/数字/_ . : / + = -）")
	}
	if !verificationTokenOK(content) {
		return "", "", fmt.Errorf("site_verification_meta 的 content 含非法字符（仅允许字母/数字/_ . : / + = -）")
	}
	return name, content, nil
}
