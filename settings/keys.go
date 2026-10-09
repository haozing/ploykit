package settings

import (
	"context"
	"fmt"
	"net"
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
	KindInfo, KindWarn        = "info", "warn"
	FlagOff, FlagOn           = "0", "1"
)

var KeyOrder = []string{
	KeyBannerText, KeyBannerKind, KeyMaintenanceMode, KeyAllowSignup, KeyAllowedDomains,
	KeyRateLimitPerUserPerMin, KeyRateLimitPerIPPerMin, KeyRateLimitAllowlist,
}

var Defaults = map[string]string{
	KeyBannerText:             "",
	KeyBannerKind:             KindInfo,
	KeyMaintenanceMode:        FlagOff,
	KeyAllowSignup:            FlagOn,
	KeyAllowedDomains:         "",
	KeyRateLimitPerUserPerMin: "0",
	KeyRateLimitPerIPPerMin:   "30",
	KeyRateLimitAllowlist:     "",
}

var Descriptions = map[string]string{
	KeyBannerText:             "站点公告文本（空 = 无公告）；保存后全站顶条即时生效",
	KeyBannerKind:             "公告样式：info = 蓝系 / warn = 橙红系",
	KeyMaintenanceMode:        "维护模式：开启后全站顶栏显示「维护中」条（仅提示，不阻断请求）",
	KeyAllowSignup:            "注册开关：关闭 = 邀请制（仅白名单邮箱可注册）；保存后即时生效（SignupGate 热读）",
	KeyAllowedDomains:         "注册邮箱域名白名单，逗号分隔（空 = 不限域名）",
	KeyRateLimitPerUserPerMin: "API 每用户限流（请求/分钟）：0 = 关闭；修改后重启生效（启动期静态注入，不热重载）",
	KeyRateLimitPerIPPerMin:   "认证路径每客户端 IP 限流（请求/分钟）：0 = 关闭；修改后重启生效",
	KeyRateLimitAllowlist:     "限流豁免名单：逗号分隔 IP 或 CIDR（如 10.0.0.5, 192.168.0.0/16）；修改后重启生效",
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
		}
	}
	return Defaults[key]
}

func (s *Store) value(ctx context.Context, key string) (string, error) {
	v, found, err := s.Get(ctx, key)
	if err != nil {
		return "", err
	}
	return s.effectiveValue(key, v, found), nil
}

func (s *Store) Effective(ctx context.Context) (map[string]string, error) {
	out := map[string]string{}
	for _, k := range KeyOrder {
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

func validRatePerMin(n int) bool { return n >= 0 && n <= 100000 }

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
	default:
		return fmt.Errorf("未知设置键 %q（白名单：%s）", key, strings.Join(KeyOrder, ", "))
	}
}
