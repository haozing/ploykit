package redactx

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

type rule struct {
	kind string
	re   *regexp.Regexp
}

var rules = []rule{
	{"aws_access_key", regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`)},
	{"aws_secret", regexp.MustCompile(`(?i)aws.{0,20}?(?:secret|sk).{0,20}?['"=:\s]([A-Za-z0-9/+=]{40})['"\s]?`)},
	{"pem_private_key", regexp.MustCompile(`-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----`)},
	{"github_token", regexp.MustCompile(`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b`)},
	{"anthropic_key", regexp.MustCompile(`\bsk-ant-(?:api|admin)03-[A-Za-z0-9_-]{24,}\b`)},
	{"openai_key", regexp.MustCompile(`\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b`)},
	{"slack_token", regexp.MustCompile(`\bxox[abposr]-[A-Za-z0-9-]{10,}\b`)},
	{"gitlab_token", regexp.MustCompile(`\bglpat-[A-Za-z0-9_-]{20,}\b`)},
	{"google_api_key", regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}\b`)},
	{"stripe_key", regexp.MustCompile(`\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}\b`)},
	{"jwt", regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`)},
	{"bearer", regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._+/=-]{16,}`)},

	{"conn_string", regexp.MustCompile(`(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s:@/]*(?::[^\s]*)?@`)},
	{"generic_secret_env", regexp.MustCompile(`(?i)\b(?:SECRET|TOKEN|PASSWORD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)['"=:\s]{1,3}[A-Za-z0-9/+_-]{16,}`)},
	{"private_key_block", regexp.MustCompile(`(?i)\b(?:rsa|ec|ed25519)?\s*(?:private\s*key)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{32,}`)},
	{"heroku_slack_webhook", regexp.MustCompile(`\bhttps://hooks\.slack\.com/services/T[A-Za-z0-9]+/B[A-Za-z0-9]+/[A-Za-z0-9]+`)},
}

const maxDepth = 32

const depthCapSentinel = "[REDACTED:depth-limit]"

func String(s string) string {
	for _, r := range rules {
		s = r.re.ReplaceAllString(s, "[REDACTED:"+r.kind+"]")
	}
	return s
}

func Sanitize(s string) string {
	if !strings.ContainsRune(s, 0) && utf8.ValidString(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		c := s[i]
		switch {
		case c == 0x00:
			i++
		case c < utf8.RuneSelf:
			b.WriteByte(c)
			i++
		default:
			r, size := utf8.DecodeRuneInString(s[i:])
			if r == utf8.RuneError && size == 1 {
				b.WriteRune(utf8.RuneError)
				i++
				continue
			}
			b.WriteString(s[i : i+size])
			i += size
		}
	}
	return b.String()
}

func Any(v any) any { return anyDepth(v, 0) }

func anyDepth(v any, depth int) any {
	switch t := v.(type) {
	case string:
		return String(t)
	case error:

		return String(t.Error())
	case fmt.Stringer:
		return String(t.String())
	case map[string]any:
		if depth >= maxDepth {
			return depthCapSentinel
		}

		out := make(map[string]any, len(t))
		for k, val := range t {
			out[k] = anyDepth(val, depth+1)
		}
		return out
	case []any:
		if depth >= maxDepth {
			return depthCapSentinel
		}
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = anyDepth(val, depth+1)
		}
		return out
	default:
		return v
	}
}

func SanitizeDeep(v any) any { return sanitizeDepth(v, 0) }

func sanitizeDepth(v any, depth int) any {
	switch t := v.(type) {
	case string:
		return Sanitize(t)
	case error:

		return Sanitize(t.Error())
	case map[string]any:
		if depth >= maxDepth {
			return depthCapSentinel
		}
		out := make(map[string]any, len(t))
		for k, val := range t {
			out[Sanitize(k)] = sanitizeDepth(val, depth+1)
		}
		return out
	case []any:
		if depth >= maxDepth {
			return depthCapSentinel
		}
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = sanitizeDepth(val, depth+1)
		}
		return out
	default:
		return v
	}
}
