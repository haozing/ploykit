package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	KeyBannerText      = "banner_text"
	KeyBannerKind      = "banner_kind"
	KeyMaintenanceMode = "maintenance_mode"
	KeyAllowSignup     = "allow_signup"
	KeyAllowedDomains  = "allowed_domains"

	KeyRateLimitPerUserPerMin = "rate_limit_per_user_per_min"
	KeyRateLimitPerIPPerMin   = "rate_limit_per_ip_per_min"
	KeyRateLimitAllowlist     = "rate_limit_allowlist"

	KeySMTPHost = "smtp_host"
	KeySMTPPort = "smtp_port"
	KeySMTPUser = "smtp_user"
	KeySMTPPass = "smtp_pass"
	KeySMTPFrom = "smtp_from"

	KeySiteVerificationMeta = "site_verification_meta"

	KeyShellNavHidden = "shell_nav_hidden"

	KindInfo, KindWarn = "info", "warn"
	FlagOff, FlagOn    = "0", "1"
)

// MaskedValue is what sensitive keys (IsSensitive) render as in every
// read-back surface: the admin list response (both items and effective), the
// put response body and the admin.setting_change log entries. A client that
// submits MaskedValue back means "unchanged" — the put handler short-circuits
// on it without touching the store.
const MaskedValue = "******"

var KeyOrder = []string{
	KeyBannerText, KeyBannerKind, KeyMaintenanceMode, KeyAllowSignup, KeyAllowedDomains,
	KeyRateLimitPerUserPerMin, KeyRateLimitPerIPPerMin, KeyRateLimitAllowlist,
	KeySMTPHost, KeySMTPPort, KeySMTPUser, KeySMTPPass, KeySMTPFrom,
	KeySiteVerificationMeta,
	KeyShellNavHidden,
}

// builtinKeySet mirrors KeyOrder for O(1) registry-collision checks.
var builtinKeySet = func() map[string]bool {
	m := make(map[string]bool, len(KeyOrder))
	for _, k := range KeyOrder {
		m[k] = true
	}
	return m
}()

var Defaults = map[string]string{
	KeyBannerText:             "",
	KeyBannerKind:             KindInfo,
	KeyMaintenanceMode:        FlagOff,
	KeyAllowSignup:            FlagOn,
	KeyAllowedDomains:         "",
	KeyRateLimitPerUserPerMin: "0",
	KeyRateLimitPerIPPerMin:   "30",
	KeyRateLimitAllowlist:     "",

	KeySMTPHost:             "",
	KeySMTPPort:             "587",
	KeySMTPUser:             "",
	KeySMTPPass:             "",
	KeySMTPFrom:             "",
	KeySiteVerificationMeta: "",
	KeyShellNavHidden:       "",
}

var Descriptions = map[string]string{
	KeyBannerText:             "站点公告文本，空 = 不展示公告",
	KeyBannerKind:             "公告样式：info = 蓝系 / warn = 橙红系",
	KeyMaintenanceMode:        "维护模式：开启后全站顶栏显示「维护中」条（仅提示，不阻断请求）",
	KeyAllowSignup:            "注册开关：关闭 = 邀请制，仅白名单内邮箱可注册",
	KeyAllowedDomains:         "注册邮箱域名白名单，逗号分隔（空 = 不限域名）",
	KeyRateLimitPerUserPerMin: "API 每用户限流（请求/分钟）：0 = 关闭；修改后需重启生效",
	KeyRateLimitPerIPPerMin:   "认证路径每客户端 IP 限流（请求/分钟）：0 = 关闭；修改后重启生效",
	KeyRateLimitAllowlist:     "限流豁免名单：逗号分隔 IP 或 CIDR（如 10.0.0.5, 192.168.0.0/16）；修改后重启生效",

	KeySMTPHost:             "SMTP 服务器主机名（如 smtp.example.com；空 = 开发日志通道，邮件只写日志不外发）",
	KeySMTPPort:             "SMTP 端口（空 = 缺省 587）",
	KeySMTPUser:             "SMTP 认证用户名（空 = 不认证）",
	KeySMTPPass:             "SMTP 认证密码：保存后仅以掩码回显；落库前经 PLOYKIT_SEAL_KEY 加密，未配置该环境变量时拒绝保存",
	KeySMTPFrom:             "发件人邮箱（如 no-reply@example.com；空 = 未配置发件人）",
	KeySiteVerificationMeta: "站长验证：粘贴搜索引擎给的完整 <meta> 标签或 name|content 对（如 google-site-verification|abc123）；清空即移除",
	KeyShellNavHidden:       "产品壳侧边栏隐藏菜单：JSON 字符串数组，元素为菜单路径（如 [\"/realtime\",\"/settings/workspace/schedules\"]）；空 = 全部显示",
}

// BillingChannelKeyPrefix namespaces the payment-channel credential keys
// (BC-5): every `billing_channel.<name>.<field>` row (e.g.
// billing_channel.waffo.merchant_id) lives in the generic site_settings KV
// table, is sealed at rest like smtp_pass, and is deliberately NOT a KeyOrder
// member — the generic settings page never renders channel cards; that
// surface is the dedicated admin billing-channels API.
const BillingChannelKeyPrefix = "billing_channel."

// IsSensitive reports whether the key holds a credential that must never be
// echoed in plaintext — every read-back surface masks it with MaskedValue.
// smtp_pass plus the whole billing_channel.* namespace (BC-5): channel
// merchant ids, product ids and modes are as sensitive as the secrets —
// anything with the prefix seals at rest and unseals fail-closed.
func IsSensitive(key string) bool {
	return key == KeySMTPPass || strings.HasPrefix(key, BillingChannelKeyPrefix)
}

// Seeding semantics — decision D2 (docs/plan-upstream-shuijing-admin-billing.md):
// the two generations of env-backed keys deliberately fork at first boot.
//
// Old keys (banner_*/maintenance_mode/allow_signup/allowed_domains/
// rate_limit_*) are BOOTSTRAP-SEEDED: Bootstrap copies the effective env
// value into site_settings on first boot; from then on the DB row wins over
// the env ("DB row > env" short-circuit in value()), so env changes after
// first boot are silently ignored. That was acceptable for flags admins
// manage from the UI, and existing deployments rely on the behavior.
//
// New keys (smtp_*, site_verification_meta) are NEVER SEEDED: seedable()
// filters them out of the Bootstrap loop. Reasons: (1) smtp_pass is a
// credential — an env value must not be frozen into the generic
// site_settings table just because it happened to be set on first boot;
// (2) unseeded keys keep their env fallback live on every reboot until an
// admin explicitly saves a value in the admin UI — no "env silently stopped
// working" trap; (3) the admin list endpoint surfaces the env fallback via
// Effective(), so the UI reads correctly even with no DB row.
//
// Unifying the old keys to "never seed" would strand deployments relying on
// first-boot seeding; unifying the new keys to "seed everything" re-creates
// the env-freeze trap. Hence the documented fork instead of one rule.
func seedable(key string) bool {
	switch key {
	case KeySMTPHost, KeySMTPPort, KeySMTPUser, KeySMTPPass, KeySMTPFrom, KeySiteVerificationMeta,
		KeyShellNavHidden:
		return false
	}
	return true
}

func envOf(key string) string {
	switch key {
	case KeyAllowSignup:
		return "ALLOW_SIGNUP"
	case KeyAllowedDomains:
		return "ALLOWED_DOMAINS"
	case KeyRateLimitPerUserPerMin:
		return "RATE_LIMIT_PER_USER_PER_MIN"
	case KeyRateLimitPerIPPerMin:
		return "RATE_LIMIT_PER_IP_PER_MIN"
	case KeyRateLimitAllowlist:
		return "RATE_LIMIT_ALLOWLIST"
	case KeySMTPHost:
		return "SMTP_HOST"
	case KeySMTPPort:
		return "SMTP_PORT"
	case KeySMTPUser:
		return "SMTP_USER"
	case KeySMTPPass:
		return "SMTP_PASS"
	case KeySMTPFrom:
		return "SMTP_FROM"
	case KeySiteVerificationMeta:
		return "SITE_VERIFICATION_META"
	}
	return ""
}

func envFlag(raw string) (flag string, ok bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "true", "1", "on", "yes":
		return FlagOn, true
	case "false", "0", "off", "no":
		return FlagOff, true
	}
	return "", false
}

func (s *Store) effectiveValue(key, tableValue string, found bool) string {
	if found {
		return tableValue
	}
	// Registered keys resolve their no-row fallback through the spec (env
	// live-fallback > Default); they never take part in bootstrap seeding.
	if spec, ok := s.specOf(key); ok {
		return s.effectiveSpecValue(spec)
	}
	envName := envOf(key)
	if envName != "" && s.env != nil {
		switch key {
		case KeyAllowSignup:
			if f, ok := envFlag(s.env(envName)); ok {
				return f
			}
		case KeyAllowedDomains:
			if raw := strings.TrimSpace(s.env(envName)); raw != "" {
				return raw
			}
		case KeyRateLimitPerUserPerMin, KeyRateLimitPerIPPerMin:

			if n, err := strconv.Atoi(strings.TrimSpace(s.env(envName))); err == nil && validRatePerMin(n) {
				return strconv.Itoa(n)
			}
		case KeyRateLimitAllowlist:
			if raw := strings.TrimSpace(s.env(envName)); raw != "" {
				return raw
			}
		case KeySMTPHost, KeySMTPUser, KeySMTPPass, KeySMTPFrom, KeySiteVerificationMeta:
			if raw := strings.TrimSpace(s.env(envName)); raw != "" {
				return raw
			}
		case KeySMTPPort:
			if n, err := strconv.Atoi(strings.TrimSpace(s.env(envName))); err == nil && validSMTPPort(n) {
				return strconv.Itoa(n)
			}
		}
	}
	return Defaults[key]
}

func (s *Store) value(ctx context.Context, key string) (string, error) {
	v, found, err := s.Get(ctx, key)
	if err != nil {
		return "", err
	}
	if found && s.IsSensitive(key) {
		// Fail-closed on reads too: a stored credential row must unseal or
		// the read errors — there is no plaintext fallback for DB rows
		// (legacy plaintext surfaces sealx.ErrPlaintext). The env fallback
		// (no DB row) stays plaintext by design and is never stored.
		plain, err := s.sealer.Unseal(v) // nil-receiver safe: errors when no sealer is configured
		if err != nil {
			return "", fmt.Errorf("settings: read sensitive key %s: %w", key, err)
		}
		v = plain
	}
	return s.effectiveValue(key, v, found), nil
}

// Effective resolves every key — built-ins in KeyOrder order, then
// product-registered keys in registration order (registry.go).
func (s *Store) Effective(ctx context.Context) (map[string]string, error) {
	keys := append(append([]string(nil), KeyOrder...), s.registeredKeys()...)
	out := map[string]string{}
	for _, k := range keys {
		v, err := s.value(ctx, k)
		if err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, nil
}

func (s *Store) RegistrationGate(ctx context.Context) (allow bool, domains []string, err error) {
	v, err := s.value(ctx, KeyAllowSignup)
	if err != nil {
		return false, nil, err
	}
	d, err := s.value(ctx, KeyAllowedDomains)
	if err != nil {
		return false, nil, err
	}
	return v == FlagOn, SplitDomains(d), nil
}

func (s *Store) Maintenance(ctx context.Context) (bool, error) {
	v, err := s.value(ctx, KeyMaintenanceMode)
	return v == FlagOn, err
}

// SMTPConfig hot-reads the outbound mail settings (same shape as Maintenance):
// DB row > env fallback > Defaults, with the stored smtp_pass decrypted. An
// empty host keeps the dev-channel semantics (log-only mailer); port defaults
// to 587. Meant for product hot-mailers polling on a short TTL.
func (s *Store) SMTPConfig(ctx context.Context) (host string, port int, user, pass, from string, err error) {
	if host, err = s.value(ctx, KeySMTPHost); err != nil {
		return "", 0, "", "", "", err
	}
	portStr, err := s.value(ctx, KeySMTPPort)
	if err != nil {
		return "", 0, "", "", "", err
	}
	if user, err = s.value(ctx, KeySMTPUser); err != nil {
		return "", 0, "", "", "", err
	}
	if pass, err = s.value(ctx, KeySMTPPass); err != nil {
		return "", 0, "", "", "", err
	}
	if from, err = s.value(ctx, KeySMTPFrom); err != nil {
		return "", 0, "", "", "", err
	}
	return host, parseSMTPPort(portStr), user, pass, from, nil
}

// SiteVerificationMeta hot-reads the verification meta in its normalized
// `name|content` stored form (DB row > env SITE_VERIFICATION_META > "").
// Parse the pair with ParseVerificationMeta and recompose the tag
// server-side — stored user input is never reflected verbatim.
func (s *Store) SiteVerificationMeta(ctx context.Context) (string, error) {
	return s.value(ctx, KeySiteVerificationMeta)
}

func validRatePerMin(n int) bool { return n >= 0 && n <= 100000 }

func validSMTPPort(n int) bool { return n >= 1 && n <= 65535 }

func parseSMTPPort(v string) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || !validSMTPPort(n) {
		return 587
	}
	return n
}

func hostCharsetOK(s string) bool {
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r == '.', r == '-':
		default:
			return false
		}
	}
	return true
}

func printableASCII(s string) bool {
	for _, r := range s {
		if r < 0x20 || r > 0x7E {
			return false
		}
	}
	return true
}

var emailFmtRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func emailValid(s string) bool { return len(s) <= 254 && emailFmtRe.MatchString(s) }

func parsePerMin(v string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || !validRatePerMin(n) {
		return def
	}
	return n
}

func (s *Store) RateLimits(ctx context.Context) (perUser, perIP int, allowlist []string, err error) {
	u, err := s.value(ctx, KeyRateLimitPerUserPerMin)
	if err != nil {
		return 0, 0, nil, err
	}
	i, err := s.value(ctx, KeyRateLimitPerIPPerMin)
	if err != nil {
		return 0, 0, nil, err
	}
	a, err := s.value(ctx, KeyRateLimitAllowlist)
	if err != nil {
		return 0, 0, nil, err
	}
	ipDef, _ := strconv.Atoi(Defaults[KeyRateLimitPerIPPerMin])
	return parsePerMin(u, 0), parsePerMin(i, ipDef), SplitIPAllowlist(a), nil
}

func SplitIPAllowlist(csv string) []string {
	seen := map[string]bool{}
	var out []string
	for _, p := range strings.Split(csv, ",") {
		if p = strings.TrimSpace(p); p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

func ipOrCIDROK(s string) bool {
	if _, _, err := net.ParseCIDR(s); err == nil {
		return true
	}
	return net.ParseIP(s) != nil
}

func SplitDomains(csv string) []string {
	seen := map[string]bool{}
	var out []string
	for _, p := range strings.Split(csv, ",") {
		if p = strings.ToLower(strings.TrimSpace(p)); p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

func domainOK(d string) bool {
	if d == "" || !strings.Contains(d, ".") || len(d) > 253 {
		return false
	}
	for _, r := range d {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '.', r == '-':
		default:
			return false
		}
	}
	return true
}

func Normalize(key, value string) string {
	switch key {
	case KeyBannerText:
		return strings.TrimSpace(value)
	case KeyAllowedDomains:
		return strings.Join(SplitDomains(value), ",")
	case KeyRateLimitAllowlist:
		return strings.Join(SplitIPAllowlist(value), ",")
	case KeySiteVerificationMeta:
		// Unparsable input falls through to the trimmed raw string; the put
		// path always runs Validate first, so it is rejected before this
		// normalization result is ever stored.
		if pair, ok := normalizeVerificationMeta(value); ok {
			return pair
		}
	}
	return strings.TrimSpace(value)
}

func Validate(key, value string) error {
	switch key {
	case KeyBannerText:
		if utf8.RuneCountInString(value) > 500 {
			return fmt.Errorf("公告文本最多 500 字（当前 %d）", utf8.RuneCountInString(value))
		}
		return nil
	case KeyBannerKind:
		if value != KindInfo && value != KindWarn {
			return fmt.Errorf("banner_kind 必须是 %q 或 %q", KindInfo, KindWarn)
		}
		return nil
	case KeyMaintenanceMode, KeyAllowSignup:
		if value != FlagOff && value != FlagOn {
			return fmt.Errorf("%s 必须是 %q 或 %q", key, FlagOff, FlagOn)
		}
		return nil
	case KeyAllowedDomains:
		for _, d := range SplitDomains(value) {
			if !domainOK(d) {
				return fmt.Errorf("无效域名 %q（仅允许小写字母/数字/点/连字符，且至少含一个点）", d)
			}
		}
		return nil
	case KeyRateLimitPerUserPerMin, KeyRateLimitPerIPPerMin:
		n, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil || !validRatePerMin(n) {
			return fmt.Errorf("%s 必须是 0..100000 的整数（0 = 关闭限流）", key)
		}
		return nil
	case KeyRateLimitAllowlist:
		for _, p := range SplitIPAllowlist(value) {
			if !ipOrCIDROK(p) {
				return fmt.Errorf("无效 IP/CIDR %q（如 10.0.0.5 或 192.168.0.0/16）", p)
			}
		}
		return nil
	case KeySMTPHost:
		if value == "" {
			return nil // 空 = 开发日志通道
		}
		if len(value) > 253 || !hostCharsetOK(value) {
			return fmt.Errorf("smtp_host 仅允许字母/数字/点/连字符且最多 253 字符（空 = 开发日志通道；端口走 smtp_port）")
		}
		return nil
	case KeySMTPPort:
		if value == "" {
			return nil // 空 = 缺省 587
		}
		if n, err := strconv.Atoi(strings.TrimSpace(value)); err != nil || !validSMTPPort(n) {
			return fmt.Errorf("smtp_port 必须是 1..65535 的整数（空 = 缺省 587）")
		}
		return nil
	case KeySMTPUser:
		if len(value) > 254 || !printableASCII(value) {
			return fmt.Errorf("smtp_user 最多 254 字符且仅允许可打印 ASCII 字符")
		}
		return nil
	case KeySMTPPass:
		if len(value) > 256 {
			return fmt.Errorf("smtp_pass 最多 256 字符")
		}
		return nil
	case KeySMTPFrom:
		if value == "" {
			return nil
		}
		if !emailValid(value) {
			return fmt.Errorf("smtp_from 必须是合法邮箱地址（如 no-reply@example.com）或空")
		}
		return nil
	case KeySiteVerificationMeta:
		return validateVerificationMeta(value)
	case KeyShellNavHidden:
		if value == "" {
			return nil // 空 = 全部显示
		}
		var paths []string
		if err := json.Unmarshal([]byte(value), &paths); err != nil {
			return fmt.Errorf("shell_nav_hidden 必须是 JSON 字符串数组（如 [\"/realtime\"]）")
		}
		if len(paths) > 64 {
			return fmt.Errorf("shell_nav_hidden 最多 64 项（当前 %d）", len(paths))
		}
		for _, p := range paths {
			if p == "" || len(p) > 120 || !strings.HasPrefix(p, "/") {
				return fmt.Errorf("shell_nav_hidden 元素必须是 以 / 开头、≤120 字符的菜单路径（当前 %q）", p)
			}
		}
		return nil
	default:
		// BC-5: billing_channel.<name>.<field> rows are written by the admin
		// billing-channels API (not the generic settings page). The key shape
		// (three dot-separated segments) and a generous value cap is all the
		// generic layer polices; field-name semantics belong to the channel's
		// ConfigSchema, enforced by that API.
		if rest, ok := strings.CutPrefix(key, BillingChannelKeyPrefix); ok {
			name, field, ok := strings.Cut(rest, ".")
			if !ok || name == "" || field == "" || strings.Contains(field, ".") {
				return fmt.Errorf("%q 必须形如 billing_channel.<渠道名>.<字段名>", key)
			}
			if len(value) > 8192 {
				return fmt.Errorf("%s 值过长（上限 8192 字符，当前 %d）", key, len(value))
			}
			return nil
		}
		return fmt.Errorf("未知设置键 %q（白名单：%s）", key, strings.Join(KeyOrder, ", "))
	}
}
