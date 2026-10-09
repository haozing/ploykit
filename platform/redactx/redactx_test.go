package redactx

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStringRedactsAllFamilies(t *testing.T) {

	cases := map[string]string{
		"key=AKIAIOSFODNN7EXAMPLE":                        "key=[REDACTED:aws_access_key]",
		"aws secret = " + repeat("Abc123+/=", 4) + "wxyz": "[REDACTED:aws_secret]",
		"-----BEGIN RSA PRIVATE KEY-----":                 "[REDACTED:pem_private_key]",
		"gh: ghp_16C7e42F292c6912E7710c838347Ae178B4a":    "gh: [REDACTED:github_token]",

		"sk-ant-api03-" + repeat("abcdef", 5):          "[REDACTED:anthropic_key]",
		"sk-proj-abc123def456ghi789jkl012":             "[REDACTED:openai_key]",
		"xoxb-123456789012-1234567890123-abc":          "[REDACTED:slack_token]",
		"glpat-" + repeat("a1B2c3", 5):                 "[REDACTED:gitlab_token]",
		"AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p67":      "[REDACTED:google_api_key]",
		"sk_live_16C7e42F292c6912E7710c8383":           "[REDACTED:stripe_key]",
		"eyJabcdefghij.klmnopqrst.uvwxyz0123":          "[REDACTED:jwt]",
		"Authorization: Bearer abcdef0123456789abcdef": "Authorization: [REDACTED:bearer]",

		"postgres://user:p@ss@dbhost:5432/x":                            "[REDACTED:conn_string]dbhost:5432/x",
		"PASSWORD=Sup3rS3cretPassw0rd":                                  "[REDACTED:generic_secret_env]",
		"rsa private key: " + repeat("AQID", 8):                         "[REDACTED:private_key_block]",
		"https://hooks.slack.com/services/T0123ABC/B0456DEF/Xyz789Ghij": "[REDACTED:heroku_slack_webhook]",
	}
	for in, want := range cases {
		assert.Equal(t, want, String(in), "input %q", in)
		assert.NotContains(t, String(in), "p@ss", "connection-string passwords must not remain")
	}
}

func TestConnStringRegression(t *testing.T) {
	t.Run("空用户名标准形态（redis://:password@host）", func(t *testing.T) {
		out := String("redis://:password@host")
		assert.Equal(t, "[REDACTED:conn_string]host", out)
		assert.NotContains(t, out, "password", "P2-6：redis 无用户名形态的密码必须脱敏")
	})
	t.Run("密码含 @ 贪婪到最后一个 @", func(t *testing.T) {
		out := String("postgres://user:p@ss@host")
		assert.Equal(t, "[REDACTED:conn_string]host", out)
		assert.NotContains(t, out, "ss", "P2-7：首 @ 之后不得残留明文")
	})
	t.Run("无凭据的普通 URL 不误伤", func(t *testing.T) {
		assert.Equal(t, "redis://host:6379", String("redis://host:6379"))
	})
}

func TestStringKeepsBenignText(t *testing.T) {

	benign := []string{
		"task completed: work item status changed to done",
		"result: all 3 items processed, 2 succeeded",
		"see https://example.com/docs for details",
		"",
	}
	for _, s := range benign {
		assert.Equal(t, s, String(s))
	}
}

func TestAnyMapRecursion(t *testing.T) {
	in := map[string]any{
		"output": "AKIAIOSFODNN7EXAMPLE",
		"nested": map[string]any{"token": "ghp_" + repeat("x1y2z3", 7)},
		"count":  3,
	}
	out := Any(in).(map[string]any)
	assert.Contains(t, out["output"], "REDACTED")
	assert.Contains(t, out["nested"].(map[string]any)["token"], "REDACTED")
	assert.Equal(t, 3, out["count"])

	assert.Equal(t, "AKIAIOSFODNN7EXAMPLE", in["output"])
}

func repeat(s string, n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += s
	}
	return out
}

func TestSanitizeStripsNUL(t *testing.T) {
	assert.Equal(t, "ab", Sanitize("a\x00b"), "embedded NUL stripped")
	assert.Equal(t, "", Sanitize("\x00\x00"), "pure NUL → empty string")
	assert.Equal(t, "CJK text ok", Sanitize("CJK text ok"), "clean string as-is")
}

func TestSanitizeReplacesInvalidUTF8(t *testing.T) {
	assert.Equal(t, "a\ufffdb", Sanitize("a\xffb"), "isolated invalid bytes → U+FFFD")
	assert.Equal(t, "\ufffd\ufffd", Sanitize("\xff\xfe"), "consecutive invalid bytes corrected one by one")
	assert.Equal(t, "CJK\ufffd\ufffdtext", Sanitize("CJK\xe4\xb8text"), "each invalid byte in the truncated sequence corrected to one U+FFFD")
	assert.Equal(t, "\ufffd\ufffd\ufffd", Sanitize("\xed\xa0\x80"), "proxy-zone invalid encodings corrected byte by byte (Go decoder rejects per byte)")

	assert.Equal(t, "CJK English 123", Sanitize("CJK English 123"))

	assert.Equal(t, "\ufffd", Sanitize("\ufffd"))
}

func TestSanitizeNULInsideMultibyte(t *testing.T) {

	assert.NotContains(t, Sanitize("\xe4\xb8\x00\xad"), "\x00")
	assert.Contains(t, Sanitize("\xe4\xb8\x00\xad"), "\ufffd")
}

func TestSanitizeDeep(t *testing.T) {
	in := map[string]any{
		"k\x00ey": "a\x00b",
		"nested":  map[string]any{"s": "\xffbad"},
	}
	out := SanitizeDeep(in).(map[string]any)
	assert.Equal(t, "ab", out["key"], "both keys and values sanitized (keys with NUL washed too)")
	assert.Equal(t, "\ufffdbad", out["nested"].(map[string]any)["s"])
	_, stillDirty := in["k\x00ey"]
	assert.True(t, stillDirty, "original map keys kept (copy does not change originals)")
	assert.Equal(t, "a\x00b", in["k\x00ey"])
}

func TestSanitizeDeepDepthCap(t *testing.T) {
	nest := func(v any, n int) map[string]any {
		for i := 0; i < n; i++ {
			v = map[string]any{"n": v}
		}
		return v.(map[string]any)
	}

	ok := SanitizeDeep(nest("a\x00b", 32)).(map[string]any)
	cur := ok
	for i := 0; i < 31; i++ {
		cur = cur["n"].(map[string]any)
	}
	assert.Equal(t, "ab", cur["n"], "strings within depth 32 still sanitized")

	over := SanitizeDeep(nest("a\x00b", 33)).(map[string]any)
	cur = over
	for i := 0; i < 31; i++ {
		cur = cur["n"].(map[string]any)
	}
	assert.Equal(t, depthCapSentinel, cur["n"],
		"depth cap 32 截断：超深子树不得原样带出（未脱敏泄露+别名共享），换哨兵占位")
}

func TestDepthCapNoAliasingNoCycle(t *testing.T) {

	cyclic := map[string]any{"n": "x"}
	cyclic["self"] = cyclic
	assert.NotPanics(t, func() {
		_, err := json.Marshal(SanitizeDeep(cyclic))
		require.NoError(t, err)
		_, err = json.Marshal(Any(cyclic))
		require.NoError(t, err)
	})
}

func TestErrorChannelAligned(t *testing.T) {
	connErr := fmt.Errorf("dial failed: postgres://user:p@ss@dbhost/x")
	assert.Equal(t, "dial failed: [REDACTED:conn_string]dbhost/x", Any(connErr))
	got := SanitizeDeep(connErr)
	s, ok := got.(string)
	assert.True(t, ok, "SanitizeDeep 必须展开 error 为字符串，不得原样穿透：%T", got)
	assert.Equal(t, "dial failed: postgres://user:p@ss@dbhost/x", s)

	binErr := fmt.Errorf("binary \xff payload")
	assert.Equal(t, "binary \ufffd payload", SanitizeDeep(binErr))
}

func TestMapKeysNotRedacted(t *testing.T) {
	in := map[string]any{
		"key=AKIAIOSFODNN7EXAMPLE":  "value-a",
		"[REDACTED:aws_access_key]": "value-b",
	}
	out := Any(in).(map[string]any)
	assert.Len(t, out, 2, "键不脱敏：两键脱敏同化的碰撞不得丢条目")
	assert.Equal(t, "value-a", out["key=AKIAIOSFODNN7EXAMPLE"])
	assert.Equal(t, "value-b", out["[REDACTED:aws_access_key]"])

	sd := SanitizeDeep(map[string]any{"k\x00ey": "v"}).(map[string]any)

	assert.Equal(t, "v", sd["key"])
}

func TestSanitizeDeepSliceAndScalars(t *testing.T) {
	in := []any{"a\x00b", 3, nil, []any{"\xffx"}}
	out := SanitizeDeep(in).([]any)
	assert.Equal(t, "ab", out[0])
	assert.Equal(t, 3, out[1])
	assert.Nil(t, out[2])
	assert.Equal(t, "\ufffdx", out[3].([]any)[0])

	assert.Equal(t, "a\x00b", in[0])
}
