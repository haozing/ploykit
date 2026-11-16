package main

import (
	"bytes"
	"context"
	"database/sql"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/haozing/ploykit/admin"
	"github.com/haozing/ploykit/admin/adapters/bridge"
	adminhttp "github.com/haozing/ploykit/admin/adapters/http"
	adminpg "github.com/haozing/ploykit/admin/adapters/pgrepo"
	adminapp "github.com/haozing/ploykit/admin/app"
	analyticspg "github.com/haozing/ploykit/analytics/adapters/pgrepo"
	analyticsworkers "github.com/haozing/ploykit/analytics/adapters/workers"
	analyticsapp "github.com/haozing/ploykit/analytics/app"
	auditrec "github.com/haozing/ploykit/audit"
	audithttp "github.com/haozing/ploykit/audit/adapters/http"
	auditworkers "github.com/haozing/ploykit/audit/adapters/workers"
	"github.com/haozing/ploykit/authz"
	authzpg "github.com/haozing/ploykit/authz/adapters/pgrepo"
	"github.com/haozing/ploykit/billing"
	billinghttp "github.com/haozing/ploykit/billing/adapters/http"
	paypal "github.com/haozing/ploykit/billing/adapters/paypal"
	billingpg "github.com/haozing/ploykit/billing/adapters/pgrepo"
	sim "github.com/haozing/ploykit/billing/adapters/sim"
	simhttp "github.com/haozing/ploykit/billing/adapters/sim/simhttp"
	stripe "github.com/haozing/ploykit/billing/adapters/stripe"
	waffo "github.com/haozing/ploykit/billing/adapters/waffo"
	billingapp "github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/identity"
	identityhttp "github.com/haozing/ploykit/identity/adapters/http"
	oauthgh "github.com/haozing/ploykit/identity/adapters/oauth/github"
	oauthgoogle "github.com/haozing/ploykit/identity/adapters/oauth/googleoidc"
	oidcfed "github.com/haozing/ploykit/identity/adapters/oauth/oidcfed"
	identitypg "github.com/haozing/ploykit/identity/adapters/pgrepo"
	identityapp "github.com/haozing/ploykit/identity/app"
	legal "github.com/haozing/ploykit/legal"
	legalhttp "github.com/haozing/ploykit/legal/adapters/http"
	"github.com/haozing/ploykit/migrations"
	bellog "github.com/haozing/ploykit/notify/adapters/bell"
	emaildev "github.com/haozing/ploykit/notify/adapters/email/emaildev"
	notifyresend "github.com/haozing/ploykit/notify/adapters/email/resend"
	notifysmtp "github.com/haozing/ploykit/notify/adapters/email/smtp"
	notifyhttp "github.com/haozing/ploykit/notify/adapters/http"
	notifyworkers "github.com/haozing/ploykit/notify/adapters/workers"
	notifyapp "github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/devx"
	"github.com/haozing/ploykit/platform/egressx"
	"github.com/haozing/ploykit/platform/events"
	"github.com/haozing/ploykit/platform/logring"
	logx "github.com/haozing/ploykit/platform/logx"
	"github.com/haozing/ploykit/platform/mcpx"
	"github.com/haozing/ploykit/platform/metrics"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/pgpart"
	"github.com/haozing/ploykit/platform/redactx"
	"github.com/haozing/ploykit/platform/renderx"
	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/platform/storagex"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/workers"
	"github.com/haozing/ploykit/platform/wsx"
	"github.com/haozing/ploykit/provisioning"

	billingworkers "github.com/haozing/ploykit/billing/adapters/workers"
	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/redisx"
	"github.com/haozing/ploykit/platform/relayx"
	"github.com/haozing/ploykit/quota"
	quotahttp "github.com/haozing/ploykit/quota/adapters/http"
	quotaworkers "github.com/haozing/ploykit/quota/adapters/workers"
	"github.com/haozing/ploykit/schedule"
	schedulehttp "github.com/haozing/ploykit/schedule/adapters/http"
	"github.com/haozing/ploykit/settings"
	settingshttp "github.com/haozing/ploykit/settings/adapters/http"
	webhookhttp "github.com/haozing/ploykit/webhooks/adapters/http"
	webhookpg "github.com/haozing/ploykit/webhooks/adapters/pgrepo"
	webhookworkers "github.com/haozing/ploykit/webhooks/adapters/workers"
	webhooksapp "github.com/haozing/ploykit/webhooks/app"
	"github.com/haozing/ploykit/workspace"
	workspacehttp "github.com/haozing/ploykit/workspace/adapters/http"
	workspacepg "github.com/haozing/ploykit/workspace/adapters/pgrepo"
	workspaceapp "github.com/haozing/ploykit/workspace/app"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/haozing/ploykit/platform/capx"
	"github.com/haozing/ploykit/platform/wswire"

	"myproduct/internal/authorization"
	"myproduct/internal/blog"
	"myproduct/internal/devtools"
	"myproduct/internal/eventsdemo"
	"myproduct/internal/task"
	videohttp "myproduct/internal/video/adapters/http"
	videomcp "myproduct/internal/video/adapters/mcp"
	videoapp "myproduct/internal/video/app"
	"myproduct/internal/video/app/scriptgen"
	"myproduct/internal/video/app/template"
	videorender "myproduct/internal/video/render"
)

//go:embed migrations/*.sql
var productMigrations embed.FS

// ga4IDRe pins the GA4 Measurement ID shape (G- followed by 4..32
// alphanumeric chars; real IDs are ~10). Validation only — the value is a
// public identifier that ships in every page's HTML, not a credential.
var ga4IDRe = regexp.MustCompile(`^G-[A-Za-z0-9]{4,32}$`)

// ga4KeySpec is the product-registered settings key behind the admin GA4
// field (docs/visitor-analytics.md Route 1 wired in example): the Measurement
// ID is a public identifier — it ships in every page's HTML once configured —
// so the key is NOT Sensitive (no sealing, rides the public /config for the
// frontend GA4Boot). Env fallback follows the "never seeded" generation: the
// env value stays live on every boot until an admin saves a DB row.
func ga4KeySpec() settings.KeySpec {
	return settings.KeySpec{
		Key:         "ga4_measurement_id",
		Env:         "GA4_MEASUREMENT_ID",
		Description: "Google Analytics 4 Measurement ID（G- 开头，GA4 管理后台 → 数据流 → 网页流详情）：配置后全站页面注入 gtag.js 统计；清空 = 停用。注意 EEA 访客需自担同意横幅合规",
		Validate: func(v string) error {
			if v == "" {
				return nil // 空 = 未配置
			}
			// 管理台 PUT 是 Validate(原始值) 在前、Normalize 在后
			// （settings/adapters/http/http.go），所以剪空白必须发生在
			// 校验内部——否则粘贴带尾随空格的 ID 会得到格式错误而非静默剪裁。
			if !ga4IDRe.MatchString(strings.TrimSpace(v)) {
				return errors.New("ga4_measurement_id 必须形如 G-XXXXXXXXXX（GA4 管理后台 → 数据流获取；空 = 停用统计）")
			}
			return nil
		},
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
		slog.Warn("invalid int env, using default", "key", key, "value", v, "default", def)
	}
	return def
}

// masterSecretEnv optionally holds ONE master secret for the product; when
// PLOYKIT_SEAL_KEY / IP_HASH_SECRET are unset, per-purpose keys are derived
// from it via sealx.DeriveKey instead.
const masterSecretEnv = "PLOYKIT_MASTER_SECRET"

// resolvedSecrets is the outcome of resolving the credential-seal key and the
// IP-hash salt from env (see resolveSecrets).
type resolvedSecrets struct {
	// SealKey is the credential-seal key; nil means "no seal key" (the None
	// form: sealed writes are rejected, unsealed reads fail).
	SealKey []byte
	// SealFromMaster reports that SealKey was derived from PLOYKIT_MASTER_SECRET
	// (for the boot log).
	SealFromMaster bool
	// IPHash is the resolved IP-hash salt; "" means no secret env applies and
	// the caller keeps its production-fatal / dev-default policy.
	IPHash string
}

// resolveSecrets resolves PLOYKIT_SEAL_KEY / IP_HASH_SECRET / the optional
// PLOYKIT_MASTER_SECRET into the seal key and IP-hash salt. Per concern the
// explicit env var always wins; otherwise the master secret fills in a
// domain-derived value. With none of them set the result reproduces the
// legacy behavior: no seal key, no IP-hash secret.
func resolveSecrets(getenv func(string) string) (resolvedSecrets, error) {
	var r resolvedSecrets
	master := strings.TrimSpace(getenv(masterSecretEnv))
	if v := strings.TrimSpace(getenv(sealx.EnvKey)); v != "" {
		key, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			return r, fmt.Errorf("%s is not valid base64: %w", sealx.EnvKey, err)
		}
		r.SealKey = key
	} else if master != "" {
		r.SealKey = sealx.DeriveKey(master, "credential-sealing")
		r.SealFromMaster = true
	}
	if v := getenv("IP_HASH_SECRET"); v != "" {
		r.IPHash = v
	} else if master != "" {
		r.IPHash = hex.EncodeToString(sealx.DeriveKey(master, "ip-hash"))
	}
	return r, nil
}

type mailerChannel interface {
	identityapp.EmailSender
	notifyapp.EmailSender
}

// exampleMailTemplates is the English copy set shared by every real email
// channel (UP-7 seam: per-product copy). One Templates value drives both the
// SMTP and the Resend adapter — notifysmtp.Templates is a mailtpl.Templates
// alias, so both channels compile the same copy (single source of copy).
func exampleMailTemplates() notifysmtp.Templates {
	return notifysmtp.Templates{
		LoginCode: notifysmtp.Template{
			Subject: "Your sign-in code",
			Body:    "Your sign-in code is {{.Code}}.\n\nIf you did not request it, you can ignore this email.",
		},
		Invite: notifysmtp.Template{
			Subject: "Workspace invitation",
			Body:    "You have been invited to join workspace \"{{.Workspace}}\".\n\nInvitation reference: {{.InvitationID}}",
		},
		PasswordReset: notifysmtp.Template{
			Subject: "Reset your password",
			Body:    "Open the link below to reset your password (it expires; ignore this email if it wasn't you):\n{{.Link}}",
		},
		EmailVerification: notifysmtp.Template{
			Subject: "Verify your email",
			Body:    "Open the link below to verify your email:\n{{.Link}}",
		},
	}
}

// assembleMailer picks the outbound mail channel (shuijing batch 2026-10-25):
// Resend HTTP first (resend_api_key + resend_from via the settings registry —
// DB row sealed at rest > env RESEND_API_KEY/RESEND_FROM), then SMTP (env),
// then the log-only dev channel. Boot-time resolution: admin edits to the
// registered keys apply after restart, same contract as the rate-limit keys.
func assembleMailer(log *slog.Logger, siteSettings *settings.Store) (mailerChannel, string) {
	tpl := exampleMailTemplates()
	eff, err := siteSettings.Effective(context.Background())
	if err != nil {
		log.Error("settings effective for mail channel", "err", err)
		os.Exit(1)
	}
	if key, from := eff["resend_api_key"], eff["resend_from"]; key != "" && from != "" {
		sender, err := notifyresend.NewWithTemplates(notifyresend.Config{
			APIKey: key,
			From:   from,
		}, tpl, log)
		if err != nil {
			log.Error("resend templates invalid", "err", err)
			os.Exit(1)
		}
		log.Info("mail channel: resend HTTP API")
		return sender, settingshttp.MailModeResend
	}

	if host := env("SMTP_HOST", ""); host != "" {
		sender, err := notifysmtp.NewWithTemplates(notifysmtp.Config{
			Host:     host,
			Port:     envInt("SMTP_PORT", 587),
			Username: env("SMTP_USER", ""),
			Password: env("SMTP_PASS", ""),
			From:     env("SMTP_FROM", "no-reply@localhost"),
		}, tpl, log)
		if err != nil {
			log.Error("smtp templates invalid", "err", err)
			os.Exit(1)
		}
		if key, from := eff["resend_api_key"], eff["resend_from"]; key != "" || from != "" {
			log.Warn("Resend channel partially configured (needs BOTH resend_api_key and resend_from); falling through to SMTP until both are set")
		}
		return sender, settingshttp.MailModeSMTP
	}
	if key := eff["resend_api_key"]; key != "" {
		log.Warn("resend_api_key set but resend_from (or SMTP_HOST) missing — no real mail channel; set resend_from to activate Resend")
	}
	log.Warn("SMTP_HOST not set; mail channel degraded to emaildev (log-only) — set RESEND_API_KEY/RESEND_FROM or SMTP_HOST/PORT/USER/PASS/FROM to enable real email")
	return emaildev.New(), settingshttp.MailModeDev
}

func redactAttr(_ []string, a slog.Attr) slog.Attr {
	if a.Value.Kind() == slog.KindString {
		a.Value = slog.StringValue(redactx.String(a.Value.String()))
	}
	return a
}

func main() {

	// Agent "eyes" (ADR 0014): capture stdout records into an in-memory ring
	// indexed by request id, so a dev agent can fetch the logs behind one
	// failed request via GET /dev/logs (off by default).
	var logRing *logring.Ring
	log := logx.New(logx.Options{
		Level:       env("LOG_LEVEL", "info"),
		Format:      env("LOG_FORMAT", ""),
		ReplaceAttr: redactAttr,
		WrapHandler: logring.Wrap(&logRing, logring.Options{}),
	})
	slog.SetDefault(log)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := pg.Connect(ctx, env("DATABASE_URL", "postgres://pk:pk@localhost:5437/pk?sslmode=disable"), pg.Options{})
	if err != nil {
		log.Error("connect db", "err", err)
		os.Exit(1)
	}
	pool := db.Pool()
	defer db.Close()

	if err := pgmigrate.Up(ctx, pool, migrations.FS, "."); err != nil {
		log.Error("framework migrate", "err", err)
		os.Exit(1)
	}
	if err := pgmigrate.Up(ctx, pool, productMigrations, "migrations"); err != nil {
		log.Error("product migrate", "err", err)
		os.Exit(1)
	}

	if err := blog.Seed(ctx, pool); err != nil {
		log.Error("blog seed", "err", err)
		os.Exit(1)
	}
	// 套餐种子：声明式覆盖框架 007 的中文名/CNY 基线（英文站给英文名 + USD）。
	// limits 故意不声明——保留 007 的 free=1/50、pro=无限 语义，后台管理员对
	// limits 的编辑也不会被每次启动回滚（种子只改它声明过的字段）。
	if err := billing.SeedPlans(ctx, pool, log, []billing.PlanSeed{
		{Code: "free", Name: "Free", Currency: "USD"},
		{Code: "pro", Name: "Pro", Currency: "USD"},
	}); err != nil {
		log.Error("plan seed", "err", err)
		os.Exit(1)
	}
	log.Info("migrations applied")

	siteSettings, err := settings.Bootstrap(pool, os.Getenv)
	if err != nil {
		log.Error("settings bootstrap", "err", err)
		os.Exit(1)
	}
	// shuijing batch (2026-10-25): product-registered settings keys for the
	// Resend email channel — the settings.RegisterKeys seam. Registered keys
	// ride the generic admin settings API and the admin UI's generic card
	// (validate + seal + mask), with a live env fallback until an admin saves
	// a DB row — zero product-owned endpoints.
	if err := siteSettings.RegisterKeys(
		settings.KeySpec{
			Key:         "resend_api_key",
			Description: "Resend API key（re_ 开头，控制台 API Keys 页获取）：启用 Resend 邮件通道；保存后仅以掩码回显，落库前经 PLOYKIT_SEAL_KEY 加密",
			Sensitive:   true,
			Env:         "RESEND_API_KEY",
			Validate: func(v string) error {
				if v != "" && !strings.HasPrefix(v, "re_") {
					return errors.New("resend_api_key 必须以 re_ 开头（Resend 控制台 → API Keys）")
				}
				return nil
			},
		},
		settings.KeySpec{
			Key:         "resend_from",
			Description: "Resend 发件人地址（需先在 Resend 控制台完成域名验证），如 no-reply@example.com；与 resend_api_key 同时配置后启用 Resend 通道",
			Env:         "RESEND_FROM",
			Validate: func(v string) error {
				if v == "" {
					return nil // 空 = 未配置
				}
				if _, err := mail.ParseAddress(v); err != nil {
					return errors.New("resend_from 必须是合法邮箱地址")
				}
				return nil
			},
		},
		// GA4 统计（docs/visitor-analytics.md Route 1 的 example 接线）：
		// spec 见 ga4KeySpec——抽出函数供 ga4_settings_test 共用同一份定义。
		ga4KeySpec(),
	); err != nil {
		log.Error("settings key registration", "err", err)
		os.Exit(1)
	}
	// UP-4 (shuijing upstream batch): first platform-admin bootstrap —
	// promotes BOOTSTRAP_ADMIN_EMAIL only while zero platform admins exist
	// (never demotes, never mints a second admin). A misconfigured value
	// refuses to start, same severity as the settings bootstrap above.
	if err := admin.BootstrapPlatformAdmin(ctx, pool, env("BOOTSTRAP_ADMIN_EMAIL", ""), log); err != nil {
		log.Error("bootstrap platform admin", "err", err)
		os.Exit(1)
	}

	authCfg := webx.DefaultAuthConfig()
	authCfg.Secure = env("SECURE_COOKIE", "false") == "true"

	signupAllowed, signupDomains, err := siteSettings.RegistrationGate(ctx)
	if err != nil {
		log.Error("registration gate", "err", err)
		os.Exit(1)
	}

	production := func() bool {
		switch strings.ToLower(env("PRODUCTION", "false")) {
		case "1", "true":
			return true
		}
		return false
	}()

	resolved, err := resolveSecrets(os.Getenv)
	if err != nil {
		log.Error("secrets env invalid", "err", err)
		os.Exit(1)
	}
	var secrets *sealx.Secrets
	if resolved.SealKey != nil {
		secrets, err = sealx.NewSecrets(resolved.SealKey)
		if err != nil {
			log.Error("seal key invalid", "err", err)
			os.Exit(1)
		}
		if resolved.SealFromMaster {
			log.Info("seal key derived from master secret", "env", masterSecretEnv, "domain", "credential-sealing")
		}
	} else {
		secrets, err = sealx.NewSecretsFromEnv() // None form: warn + nil, nil (legacy behavior)
		if err != nil {
			log.Error("PLOYKIT_SEAL_KEY invalid", "err", err)
			os.Exit(1)
		}
	}
	// UP-1 (shuijing upstream batch): sensitive settings keys (smtp_pass and
	// the registered resend_api_key) seal at rest via sealx. nil secrets (no
	// PLOYKIT_SEAL_KEY and no master secret) keeps every non-sensitive key
	// working but rejects new sensitive writes — the fail-closed posture
	// AGENTS.md mandates for sealed credentials. Attached BEFORE the mail
	// channel assembly so assembleMailer can read a stored (sealed) key.
	siteSettings = siteSettings.WithSealer(secrets)
	if resolved.IPHash != "" {
		authCfg.IPHashSecret = resolved.IPHash
	} else if production {
		log.Error("IP_HASH_SECRET is required in production: IP fingerprint salt must not be a known default")
		os.Exit(1)
	} else {
		log.Warn("IP_HASH_SECRET not set; using public dev default — set a random salt before production (ip_hash enumeration risk)")
		authCfg.IPHashSecret = "dev-ip-secret"
	}
	devCodeDefault := "000000"
	if production {
		devCodeDefault = ""
	}
	sessCfg := identityapp.SessionConfig{
		SecretPepper:   env("AUTH_SECRET", "dev-pepper-change-me"),
		AllowSignup:    signupAllowed,
		AllowedEmails:  splitCSV(os.Getenv("ALLOWED_EMAILS")),
		AllowedDomains: signupDomains,
		DevCode:        env("DEV_CODE", devCodeDefault),
		Production:     production,
	}

	now := func() time.Time { return time.Now().UTC() }

	idRepo := identitypg.New(pool, identitypg.Config{
		SessionTTL:  authCfg.SessionTTL,
		AbsoluteTTL: authCfg.AbsoluteTTL,
	})
	wsRepo := workspacepg.New(pool)
	auditor := auditrec.NewRecorder(pool, log)
	quotaSvc := quota.NewService(pool)

	mailer, mailMode := assembleMailer(log, siteSettings)
	notifyRepo := bellog.New(pool)

	notifySvc := notifyapp.NewNotifyService(notifyRepo, mailer, now).WithPrefGate(notifyRepo)
	analyticsRepo := analyticspg.New(pool, log)
	analyticsSvc := analyticsapp.NewTrackService(analyticsRepo, log)

	sessions := identityapp.NewSessionService(idRepo, mailer, sessCfg, authCfg.SessionTTL, authCfg.AbsoluteTTL, now).
		WithSignupGate(func() (bool, []string) {
			a, d, _ := siteSettings.RegistrationGate(context.Background())
			return a, d
		})

	accountSvc := identityapp.NewAccountService(idRepo, mailer, identityapp.AccountConfig{
		SecretPepper: sessCfg.SecretPepper,
		LinkBaseURL:  env("APP_URL", "http://localhost:5173"),
	}, now).WithAuditor(auditor)

	authzCatalog := authz.NewCatalog(authz.DefaultPerms()...)
	authzCatalog.Register("tasks:read", "tasks:write", "tasks:delete_own", "schedules:manage")
	// Video studio permission keys (plan-agent-video-studio §5.1): the owner
	// carries the full catalog by design; admin gets full video surface,
	// member read+write (renders stay admin/owner — they consume quota).
	authzCatalog.Register("video:read", "video:write", "video:render")
	roles := authz.DefaultRoles().Clone()
	roles.Grant(authz.RoleOwner, "tasks:read", "tasks:write", "tasks:delete_own", "schedules:manage",
		"video:read", "video:write", "video:render")
	roles.Grant(authz.RoleAdmin, "tasks:read", "tasks:write", "tasks:delete_own", "schedules:manage",
		"video:read", "video:write", "video:render")
	roles.Grant(authz.RoleMember, "tasks:read", "tasks:write", "video:read", "video:write")
	authorizer := authz.New(authzCatalog, roles, authz.WithProvider(authzpg.New(pool)))

	workspaces := workspaceapp.NewWorkspaceService(wsRepo, authorizer, mailer, auditor, workspaceapp.WorkspaceConfig{MaxPerUser: 5}, now)

	oauthEgress, err := egressx.NewHTTPClient(egressx.Opts{Timeout: 10 * time.Second})
	if err != nil {
		log.Error("oauth egress client", "err", err)
		os.Exit(1)
	}
	var oauthProviders []identityapp.OAuthProvider
	if id, secret := env("GITHUB_CLIENT_ID", ""), env("GITHUB_CLIENT_SECRET", ""); id != "" && secret != "" {
		oauthProviders = append(oauthProviders, oauthgh.New(id, secret).WithHTTPClient(oauthEgress))
	}
	if id, secret := env("GOOGLE_CLIENT_ID", ""), env("GOOGLE_CLIENT_SECRET", ""); id != "" && secret != "" {
		oauthProviders = append(oauthProviders, oauthgoogle.New(id, secret).WithHTTPClient(oauthEgress))
	}
	var oauthSvc *identityapp.OAuthService
	if len(oauthProviders) > 0 {

		oauthSvc = identityapp.NewOAuthService(idRepo, oauthProviders, now).WithSecureCookie(authCfg.Secure)
		log.Info("oauth providers registered", "providers", oauthSvc.Names())
	}

	fedOpts := []identityapp.FedOption{}
	if secrets != nil {
		fedOpts = append(fedOpts, identityapp.WithSecrets(secrets))
	}

	fedSvc := identityapp.NewFedService(idRepo, wsRepo.FindWorkspaceIDBySlug, oidcfed.NewResolver(), now, fedOpts...).
		WithSecureCookie(authCfg.Secure)

	// LC-1 legal module — the compliance P0 batch. Docs register BEFORE Wire
	// (Wire reconciles every doc's BillingModel against the legal_billing_model
	// setting and fails fast on mismatch or emptiness); channels is declared
	// here and assigned below because the ProcessorName callback must read the
	// LIVE registry (hot-configured payment channels update every legal text
	// referencing the processor, audit L5/L7) while the hooks need legalMod
	// before the registry exists. ChainHooks composes provisioning and legal
	// onto the same identity hook slots (both AfterRegister/AfterLogin).
	var channels *billingapp.AtomicRegistry
	if err := legal.RegisterDocs(
		legal.Doc{
			Key:           "tos",
			Version:       "1.0",
			EffectiveFrom: time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC),
			BillingModel:  legal.BillingV1Subscription,
			Placeholders:  []string{"legal_entity_name", "legal_jurisdiction", "payment_processor_name"},
		},
		legal.Doc{
			Key:           "privacy",
			Version:       "1.0",
			EffectiveFrom: time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC),
			BillingModel:  legal.BillingV1Subscription,
			Placeholders:  []string{"legal_entity_name", "payment_processor_name"},
		},
	); err != nil {
		log.Error("legal docs registration", "err", err)
		os.Exit(1)
	}
	legalMod, err := legal.Wire(legal.Config{
		Pool:    pool,
		Store:   siteSettings,
		Log:     log,
		Auditor: auditor,
		ProcessorName: func() string {
			if channels == nil {
				return ""
			}
			ns := channels.OrderedNames()
			if len(ns) == 0 {
				return ""
			}
			return billingapp.ProcessorDisplayName(ns[0])
		},
		SiteURL: func() string { return env("APP_URL", "http://localhost:5173") },
	})
	if err != nil {
		log.Error("legal wire", "err", err)
		os.Exit(1)
	}

	// ADR 0016: personal-workspace provisioning as one wiring line, replacing
	// the old hand-written AfterRegister literal (which only logged a welcome
	// line — PersonalWorkspace's "personal workspace provisioned" info log
	// subsumes it). The factory wires AfterRegister (ensure once) and
	// AfterLogin (re-ensure every login: JIT half-provisioning, crashes
	// mid-provision and lost races converge); OnRegisterTx stays nil because
	// a workspace insert must never roll a registration back. Idempotency is
	// the uq_workspace_personal partial unique index, not code discipline.
	// legalMod.Hooks() rides the same slots via ChainHooks (LC-3: signup
	// acceptance on every registration path incl. OAuth/code JIT, implicit
	// login acceptance backfill — both idempotent by the hooks contract).
	sessions.WithHooks(identity.ChainHooks(
		provisioning.PersonalWorkspace(provisioning.PersonalConfig{
			Pool:       pool,
			Workspaces: wsRepo,
			Quota:      quotaSvc,
			Credits:    []provisioning.Credit{{Key: "tasks_monthly", Amount: 5}},
			Log:        log,
		}),
		legalMod.Hooks(),
	))

	workspaces.WithHooks(workspace.WorkspaceHooks{
		OnTeardown: func(_ context.Context, _ pgx.Tx, workspaceID string) error {
			log.Info("workspace teardown", "ws", workspaceID)
			return nil
		},
	})

	notifyOwner := func(ctx context.Context, workspaceID, typ, title, body, dedupKey string) error {
		for page := 1; ; page++ {
			pg, err := wsRepo.ListMembers(ctx, workspaceID, page, 200)
			if err != nil {
				return err
			}
			for _, m := range pg.Items {
				if m.Role != authz.RoleOwner {
					continue
				}
				if err := notifySvc.Notify(ctx, notifyapp.NotifyInput{
					UserID: m.UserID, Type: typ, Title: title, Body: body, DedupKey: dedupKey,
				}); err != nil {
					return err
				}
			}
			if len(pg.Items) == 0 || page*200 >= pg.Total {
				return nil
			}
		}
	}

	quotaSvc.WithHooks(quota.QuotaHooks{
		OnNearLimit: func(ctx context.Context, wsID, key string, used, limit int64) error {
			return notifyOwner(ctx, wsID, "quota_near_limit", "配额即将用尽",
				fmt.Sprintf("%s 已用 %d/%d，接近套餐上限", key, used, limit),
				"quota_near:"+wsID+":"+key+":"+quota.Period(now()))
		},
		OnExhausted: func(ctx context.Context, wsID, key string) error {
			return notifyOwner(ctx, wsID, "quota_exhausted", "配额已用尽",
				fmt.Sprintf("%s 已达套餐上限，升级套餐解锁更多用量", key),
				"quota_exhausted:"+wsID+":"+key+":"+quota.Period(now()))
		},
	})

	// BC-5 热生效渠道注册表：billing_channel.<name>.* 设置行（DB 凭据）优
	// 先、env 回退（fields 空时 FromEnv/构造走 env——未迁移产品零影响），
	// 每 30s 轮询重建、原子换指针；后台保存渠道字段后同步 RefreshNow。
	// 未配置渠道返回 *app.DisabledChannel 桩（waffo/paypal 的 NewFromFields
	// 与 stripe.Disabled）：后台渠道页出卡可贴密钥（鸡生蛋断链修复——
	// 凭据齐才注册则永远没有卡可贴），活动渠道集（OrderedNames → /config
	// billing_channels/checkout）过滤掉桩；接口直返也消掉了工厂里
	// nil 重包装的 typed-nil 陷阱。
	channelFactories := map[string]func(fields map[string]string) (billingapp.PaymentChannel, error){
		"stripe": func(fields map[string]string) (billingapp.PaymentChannel, error) {
			get := func(field, envName string) string {
				if v := fields[field]; v != "" {
					return v
				}
				return os.Getenv(envName)
			}
			if k := get("secret_key", "STRIPE_SECRET_KEY"); k != "" {
				return stripe.New(k, get("webhook_signing_key", "STRIPE_WEBHOOK_SIGNING_KEY")), nil
			}
			return stripe.Disabled(), nil // 未配置：注册桩（后台可贴密钥），活动渠道集不含它
		},
		"waffo": func(fields map[string]string) (billingapp.PaymentChannel, error) {
			return waffo.NewFromFields(fields, os.Getenv, log, production)
		},
		"paypal": func(fields map[string]string) (billingapp.PaymentChannel, error) {
			return paypal.NewFromFields(fields, os.Getenv, log, production)
		},
		"manual": func(fields map[string]string) (billingapp.PaymentChannel, error) {
			infoURL := fields["info_url"]
			if infoURL == "" {
				infoURL = env("BILLING_MANUAL_INFO_URL", "")
			}
			return &billingapp.ManualChannel{InfoURL: infoURL}, nil
		},
	}
	// SIM 渠道（DEV-ONLY 测试接口）：simwaffo/simpaypal/simstripe 三个模拟
	// 渠道方言，镜像真渠道的事件协议形状，用于驱动 billing 全管线验收
	// （billing/adapters/sim）。**绝不能进生产**——双重门控：非 production 且
	// PLOYKIT_DEV_ENABLED=1（与 devx.Mount 同一 dev 开关）。DisplayOrder
	// 950+ 排在一切真渠道（含 manual 900）之后，不挤占 /config 推荐位。
	simDev := !production && env("PLOYKIT_DEV_ENABLED", "") == "1"
	if simDev {
		for name, factory := range sim.Factories(os.Getenv) {
			channelFactories[name] = factory
		}
		log.Info("sim payment channels registered (DEV-ONLY)", "channels", []string{sim.NameWaffo, sim.NamePaypal, sim.NameStripe})
	}
	channels = billingapp.NewAtomicRegistry(ctx, log, siteSettings.BillingChannelFields, channelFactories, 30*time.Second)

	billingRepo := billingpg.New(pool)
	billingSvc := billingapp.NewBillingService(
		billingRepo,
		channels,
		billingapp.Config{
			Currency:   env("BILLING_CURRENCY", "CNY"),
			SuccessURL: env("BILLING_SUCCESS_URL", "http://localhost:5173/billing/success"),
			Locale:     env("BILLING_LOCALE", ""),
		},
		billingapp.BillingHooks{

			OnPaymentFailed: func(_ context.Context, workspaceID, orderID, reason string) error {
				log.Info("billing payment failed", "workspace", workspaceID, "order", orderID, "reason", reason)
				return nil
			},
		}, auditor, now, log,
	).
		WithMeterRegistry(billingRepo).
		// F2: billing stays identity-free — the email lookup is injected here.
		// A lookup failure only drops the checkout email prefill, never fails checkout.
		WithBuyerEmailResolver(func(ctx context.Context, userID string) (string, error) {
			u, err := idRepo.GetUser(ctx, userID)
			if err != nil {
				return "", err
			}
			return u.Email, nil
		})

	whkCatalog := webhooksapp.NewEventCatalog()
	whkCatalog.Register("task.created", "任务创建")
	whkCatalog.Register("task.completed", "任务完成")

	whkCatalog.Register(billingapp.KindPaymentFailed, "支付失败")
	whkCatalog.Register(billingapp.KindOrderMarkedPaid, "订单核销（manual 标记已付）")
	whkSvc := webhooksapp.NewWebhookService(webhookpg.New(pool), whkCatalog, log, now)

	if secrets != nil {
		whkSvc = whkSvc.WithSecrets(secrets)
	}

	taskDeps := task.Deps{
		Pool: pool, Quota: quotaSvc, Analytics: analyticsSvc, Authz: authorizer,
		Webhooks: whkSvc, QuotaReleaser: quotaSvc,
	}

	wk := workers.NewWorkers(log)

	if err := events.Migrate(ctx, pool); err != nil {
		log.Error("events substrate migrate", "err", err)
		os.Exit(1)
	}
	emitter, err := events.New(pool, wk)
	if err != nil {
		log.Error("events substrate", "err", err)
		os.Exit(1)
	}

	billingSvc.WithEventEmitter(func(ctx context.Context, tx pgx.Tx, ev events.Event) error {
		return emitter.Emit(ctx, tx, ev)
	})

	mux := webx.NewMux() // recording mux: Routes() powers the runtime contract test (routes_contract_test.go)

	metricsOn := env("PLOYKIT_METRICS_ENABLED", "true") != "false"
	mnt := metrics.NewMount(metrics.Config{
		Enabled: &metricsOn,
		Path:    env("PLOYKIT_METRICS_PATH", "/metrics"),
		Token:   env("PLOYKIT_METRICS_TOKEN", ""),
	})
	mux.Handle(mnt.Path(), mnt.Handler())

	// Agent "eyes + hands" (ADR 0014): the dev surface (GET /dev/logs,
	// /dev/jobs, /dev/doctor; POST retry/cancel) and the MCP control plane
	// (/mcp) are env-gated and OFF by default. When on, they mount behind the
	// global Authenticate (PAT or session) and enforce dev:observe /
	// dev:operate scopes on PAT callers. Dev-stage tooling: they expose THIS
	// process's logs and queue — not a production observability stack.
	devOn := env("PLOYKIT_DEV_ENABLED", "") == "1"
	mcpOn := env("PLOYKIT_MCP_ENABLED", "") == "1"

	doctor := devx.NewDoctor()
	doctor.Register(devx.RiverSchemaCheck(stdlibDB(pool)))
	doctor.Register(devx.RLSCheck(stdlibDB(pool)))
	doctor.Register(devx.SealKeyCheck(sealx.EnvKey))
	doctor.Register(devx.CookieSecureCheck(authCfg.Secure, production))
	// Auth-posture trio: each catches a security setting silently holding its
	// development value in a deployment that otherwise looks healthy.
	doctor.Register(devx.AuthSecretCheck(sessCfg.SecretPepper, "dev-pepper-change-me", production))
	doctor.Register(devx.IPHashSaltCheck(authCfg.IPHashSecret, production))
	doctor.Register(devx.DevCodeCheck(sessCfg.DevCode, production))
	const eventsSoftStop = 30 * time.Second // platform/events SoftStopTimeout
	drainWindow := 10 * time.Second
	if devOn || mcpOn || env("DEV_DOCTOR_DRAIN", "") != "" {
		// The real window is known only at shutdown; wire the check against
		// the constant this boot actually uses (kept in sync below at Drain).
		drainWindow = 45 * time.Second
	}
	doctor.Register(devx.DrainWindowCheck(drainWindow, eventsSoftStop))
	doctor.Register(devx.HealthProbesCheck(2)) // db + workers, wired below on /readyz

	devDeps := devx.Deps{
		Logs:   devx.NewLogService(logRing),
		Jobs:   devx.NewJobService(emitter.Client()),
		Doctor: doctor,
		Audit: func(r *http.Request, action, target string) {
			p := webx.PrincipalFromRequest(r)
			auditor.Record(context.Background(), nil, p, action, "devx", target, nil)
		},
		Log: log,
	}
	if devOn {
		devx.Mount(mux, devDeps)
	}

	// SIM DEV HTTP 面（「模拟三个支付渠道的测试接口」）：POST /dev/billing-sim/
	// {channel}/checkout 与 /event，给人工 curl / 外部脚本驱动全管线。
	// **DEV-ONLY, 绝不能进生产（DEV-ONLY, 绝不能进生产）**——它伪造支付
	// webhook。门控与 sim 渠道注册同一 simDev（!production 且
	// PLOYKIT_DEV_ENABLED=1）；simhttp.Mount 内部还有 Production=true 即
	// panic 的兜底。边界声明：本面是测试设施，不入 OpenAPI 契约（包置于
	// billing/adapters/sim/simhttp，check_api 不扫描），生产构建不挂载。
	if simDev {
		simhttp.Mount(mux, simhttp.Deps{
			Svc:        billingSvc,
			Channels:   channels,
			Repo:       billingRepo,
			Pool:       pool,
			Now:        now,
			Log:        log,
			Production: production,
		})
	}

	var mcpMount *mcpx.Mount
	var mcpServer *devtools.Server
	if mcpOn {
		mcpMount = mcpx.NewMount(mcpx.Config{
			Enabled:       &mcpOn,
			ServerName:    "ploykit-example",
			ServerVersion: "0.0.0-dev",
		}, func(s *devtools.Server) {
			devx.RegisterTools(s, &devDeps)
			// Product-registered tools go here too — the example ships one
			// reference integration (dev tenant provisioning).
			devtools.RegisterProductTools(s, pool, log)
			mcpServer = s
		})
		mux.Handle(mcpMount.Path(), mcpMount.Handler())
	}

	idDeps := identityhttp.Deps{
		AuthCfg: authCfg, Sessions: idRepo, PATs: idRepo, Account: accountSvc,
		SessionsSvc: sessions, Tokens: identityapp.NewTokenService(idRepo, auditor, now),
		OAuth: oauthSvc, OAuthAppURL: env("APP_URL", "http://localhost:5173"),
		Fed: fedSvc,

		TrustedProxies: webx.ParseTrustedProxies(env("TRUSTED_PROXIES", "")),

		// AAL2 step-up machinery (ADR 0013 batch 2): TOTP flows mounted only
		// when the seal key exists — MFA secrets are stored sealed, so without
		// PLOYKIT_SEAL_KEY enrollment is refused upstream and the capability
		// stays absent rather than degraded.
		MFA: identityapp.NewMFAService(idRepo, sessions, secrets, "ploykit-example", now),
		// MFA settings changes (disable / regenerate backup codes) sit behind
		// the password step-up — GitHub's sudo-guarded 2FA settings shape.
		// The window is product policy: explicit per mount site.
		MFAChangeGuard: webx.RequireRecentAuth(15 * time.Minute),

		// BotGuard (human verification) intentionally NOT wired here: example
		// has no Turnstile keys and nil = capability absent (see
		// docs/platform-api-index.md). A product wires it in one line:
		//   BotGuard: webx.Turnstile(provider, nil, log)
		// where provider reads the product's settings keys (both non-empty =
		// enabled, 30s TTL hot-reload); it then guards register / send-code /
		// forgot-password / send-verification.
	}
	// Strong-profile reference wiring (ADR 0005 restart / ADR 0013 batch 1):
	// the destructive pair (workspace delete / transfer ownership) is gated
	// by the catalog evaluator — closed-set catalog + route resolver +
	// in-tx facts — instead of the static webx step-up. The challenge projects
	// onto the same webx flow (403 E_REAUTH_REQUIRED → POST /auth/confirm-password
	// → retry), so clients see one protocol on both roads. StepUp remains for
	// the role-perms routes (simple profile); double-mounting both on one
	// operation is forbidden (ADR 0011/0013).
	strongAuthz, err := authorization.New(db, authCfg, log)
	if err != nil {
		log.Error("strong-profile authorization", "err", err)
		os.Exit(1)
	}
	// AAL2-grade operation over the computed road (ADR 0013 batch 2): PAT
	// creation requires a fresh password AND MFA proof — the catalog's
	// password_and_mfa rule projects the challenge, /auth/verify-mfa clears it.
	idDeps.PATCreateGuard = strongAuthz.Middleware()

	identityhttp.Mount(mux, idDeps)

	// webx.RequireRecentAuth(15m) still guards the role-perms routes: the
	// simple-profile road. The window is product policy — pick per mount
	// site, there is no default.
	wsDeps := workspacehttp.Deps{Svc: workspaces, Members: wsRepo, Authz: authorizer,
		StepUp:      webx.RequireRecentAuth(15 * time.Minute),
		StrongGuard: strongAuthz.Middleware()}
	workspacehttp.Mount(mux, wsDeps)

	wsMW := workspacehttp.WorkspaceHeaderCtx(wsRepo)

	identityhttp.MountFedAdmin(mux, identityhttp.Deps{
		Fed: fedSvc,
		FedAdminGuard: func(next http.Handler) http.Handler {
			return wsMW(authz.Require(authorizer, "workspace:update")(next.ServeHTTP))
		},
	})

	billinghttp.Mount(mux, billinghttp.Deps{Svc: billingSvc, WsMW: wsMW, Authz: authorizer, Usage: quotaSvc.Usage})
	// LC-3/LC-9: user-facing re-acceptance endpoint (webx.P rejects
	// anonymous callers); the admin mounts live next to settingshttp below.
	legalhttp.Mount(mux, legalhttp.Deps{Svc: legalMod.Service()})

	notifyhttp.Mount(mux, notifyhttp.Deps{Svc: notifySvc})

	mux.HandleFunc("GET /api/notification-types", webx.P(func(w http.ResponseWriter, _ *http.Request, _ *webx.Principal) {
		webx.WriteJSON(w, http.StatusOK, map[string]any{
			"items": []map[string]string{
				{"type": "quota_near_limit", "label": "配额即将用尽", "description": "任一配额维度达到套餐上限 80% 时站内提醒"},
				{"type": "quota_exhausted", "label": "配额已用尽", "description": "任一配额维度达到套餐上限时站内提醒"},
				{"type": "task.created", "label": "任务已创建", "description": "创建任务后即时站内通知（含任务编号与标题）"},
			},
		})
	}))

	quotahttp.Mount(mux, quotahttp.Deps{
		Svc: quotaSvc, WsMW: wsMW, Authz: authorizer,
		AccountScopedDims: map[string]quotahttp.AccountUsageFunc{
			"workspaces": func(ctx context.Context, userID string) (int64, error) {
				n, err := wsRepo.CountWorkspacesByUser(ctx, userID)
				return int64(n), err
			},
		},
	})

	frontendOrigin := env("FRONTEND_ORIGIN", "http://localhost:5173")
	frontendHost := strings.TrimPrefix(frontendOrigin, "http://")
	frontendHost = strings.TrimPrefix(frontendHost, "https://")

	hub := wsx.NewHub(log)
	hub.AllowedOrigins = []string{frontendOrigin}

	hub.WorkspaceMember = wsx.MemberGate(func(ctx context.Context, wsID, uid string) (bool, error) {
		_, ok, err := wsRepo.GetMember(ctx, wsID, uid)
		return ok, err
	})

	hub.PATResolve = func(ctx context.Context, token string) (*webx.Principal, error) {
		return idRepo.ResolvePAT(ctx, token, time.Now())
	}

	// Video studio WS scope (plan-agent-video-studio §4.8): the scope must be
	// registered BEFORE hub.Capabilities is snapshotted below, and the custom
	// scope's subscribe gate is hub.Authorize (fail-closed when nil —
	// hub.go:437), so video:<projectID> subscriptions verify project
	// membership here. Existing workspace/user scope behavior is untouched.
	if err := wswire.RegisterScope("video"); err != nil {
		log.Error("register video ws scope", "err", err)
		os.Exit(1)
	}
	hub.Authorize = func(ctx context.Context, p *webx.Principal, connWorkspace, scopePrefix, id string) bool {
		if scopePrefix != "video" {
			return true
		}
		if p == nil || videoSvcForAccess == nil {
			return false
		}
		ok, err := videoSvcForAccess.CanAccess(ctx, p, id)
		if err != nil {
			log.Warn("video ws authorize", "err", err)
			return false
		}
		return ok
	}

	if ru := env("REDIS_URL", ""); ru != "" {
		if rclient, ok := redisx.New(ctx, ru); ok {
			relay := relayx.NewRelay(ids.NewV7().String(), relayx.NewRedisTransport(rclient), log)
			hub.Relay = relay
			go relay.Run(ctx, func(env relayx.Envelope) {
				hub.DeliverRemote(env.Scope, env.Frame)
			})
			log.Info("ws relay enabled", "channel", relayx.Channel)
		} else {
			log.Warn("REDIS_URL set but redis unreachable, running single-instance")
		}
	}
	mux.HandleFunc("GET /ws", hub.ServeWS)

	hub.Capabilities = wsx.Capabilities()

	events.Subscribe(task.KindTaskCreated, eventsdemo.Handlers(notifySvc, nil))

	for _, kind := range []string{billingapp.KindPaymentFailed, billingapp.KindOrderMarkedPaid} {
		events.Subscribe(kind, func(ctx context.Context, ev events.Event) error {
			var payload map[string]any
			if len(ev.Payload) > 0 {
				if err := json.Unmarshal(ev.Payload, &payload); err != nil {
					slog.Warn("billing webhook bridge: bad payload", "kind", ev.Kind, "err", err)
					return nil
				}
			}
			// P0-2 reference guard: a bus event without an idempotency key
			// would arrive here with an empty event id and webhooks.Emit now
			// rejects it — log-and-skip (observing the handler must not
			// crash the whole event stream) instead of the old silent drop
			// that hid missing outbox wiring until end-to-end runs.
			if ev.IDempotencyKey == "" {
				slog.Warn("billing webhook bridge: event without idempotency key — not deliverable as a webhook",
					"kind", ev.Kind, "workspace_id", ev.WorkspaceID)
				return nil
			}
			_, err := whkSvc.Emit(ctx, ev.WorkspaceID.String(), webhooksapp.OutboundEvent{
				ID: ev.IDempotencyKey, Type: ev.Kind, Payload: payload,
			})
			return err
		})
	}

	taskDeps.Emitter = emitter
	taskDeps.Publish = func(event string, payload any) {
		m, ok := payload.(map[string]any)
		if !ok {
			return
		}
		wsID, _ := m["workspace_id"].(string)
		if wsID == "" {
			return
		}
		data, err := json.Marshal(payload)
		if err != nil {
			return
		}
		_ = hub.BroadcastEvent(context.Background(), wsx.WorkspaceScope(wsID), event, data, "")
	}

	task.Mount(mux, taskDeps, wsMW)

	fireWorkers := river.NewWorkers()
	river.AddWorker(fireWorkers, schedule.NewFireWorker(pool, log))
	fireClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues:  map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 5}},
		Workers: fireWorkers,
	})

	schedule.RegisterKind("task.cleanup", func(ctx context.Context, plan schedule.SchedulePlan, scheduledFor time.Time) error {
		tag, err := pool.Exec(ctx,
			`UPDATE task SET removed_at = now()
			  WHERE removed_at IS NULL AND created_at < now() - interval '30 days'`)
		if err != nil {
			return err
		}
		log.Info("schedule fire: task.cleanup", "plan_id", plan.ID,
			"scheduled_for", scheduledFor, "soft_deleted", tag.RowsAffected())
		return nil
	})
	scheduleSvc := schedule.NewService(schedule.NewPGRepo(pool), fireClient, now)
	schedulehttp.Mount(mux, schedulehttp.Deps{
		Service: scheduleSvc,
		Guard: func(next http.Handler) http.Handler {
			return wsMW(authz.Require(authorizer, "schedules:manage")(next.ServeHTTP))
		},
	})

	adminRepo := adminpg.New(pool)

	adminSvc := adminapp.NewAdminService(adminRepo, now).WithAuditor(auditor).WithSessionRevoker(idRepo)
	adminhttp.Mount(mux, adminhttp.Deps{
		Svc: adminSvc, Rec: auditor,
		Sessions: idRepo, AuthCfg: &authCfg,
		Hooks: &admin.Hooks{

			OnImpersonation: func(_ context.Context, adminUserID, targetUserID string) error {
				log.Info("admin impersonation", "admin", adminUserID, "target", targetUserID)
				return nil
			},
		},
	})

	userOpsSvc := adminapp.NewUserOpsService(adminSvc).
		WithUserOps(bridge.NewUserOps(sessions, identityapp.NewTokenService(idRepo, auditor, now), accountSvc, adminRepo)).
		WithWorkspaceLister(bridge.NewWorkspaceLister(adminRepo))
	adminhttp.MountUserOps(mux, adminhttp.UserOpsDeps{Deps: adminhttp.Deps{Svc: adminSvc}, Ops: userOpsSvc})

	wsOpsSvc := adminapp.NewWsOpsService(adminSvc).
		WithWorkspaceOps(&bridge.WsOps{Svc: workspaces}).
		WithQuotaGranter(quotaSvc).
		WithAnnouncer(bridge.NewAnnouncer(notifySvc, adminRepo)).
		WithAnalyticsEvents(analyticsRecentAdapter{svc: analyticsSvc})
	adminhttp.MountWsOps(mux, adminhttp.WsOpsDeps{Svc: wsOpsSvc})

	billingAdminSvc := billingapp.NewBillingAdminService(billingSvc, billingpg.New(pool), now, log).
		WithUsage(quotaSvc.Usage).
		// BC-5/BC-6：渠道卡读写 billing_channel.* 设置行；保存后同步触发
		// AtomicRegistry 重建，PUT 响应里的卡片即生效态（无需重启/等轮询）。
		WithChannelSettings(siteSettings).
		WithChannelRefresher(channels)
	billingOpsSvc := adminapp.NewBillingOpsService(adminSvc).
		WithBillingOps(&bridge.BillingOps{Svc: billingAdminSvc}).
		WithWebhookOps(&bridge.WebhookOps{Svc: whkSvc})
	adminhttp.MountBillingOps(mux, adminhttp.BillingOpsDeps{Svc: billingOpsSvc})

	oauthNames := []string{}
	if oauthSvc != nil {
		oauthNames = oauthSvc.Names()
	}

	// UP-6: the admin settings OAuth card shows the *expected* callback per
	// provider, derived from the public base URL; the runtime callback is
	// computed per request from Host/X-Forwarded-Proto (identity service).
	oauthBase := env("SITE_BASE_URL", env("APP_URL", "http://localhost:8030"))
	// UP-3: the exported four-check guard (401 / platform-admin / no
	// impersonated sessions / no PATs) replaces the hand-written two-check
	// closure — reverse clause, framework grows the capability and the
	// hand-written copy goes away.
	settingshttp.MountAdmin(mux, settingshttp.AdminDeps{
		Store:      siteSettings,
		Guard:      adminhttp.PlatformAdminGuard(),
		Mailer:     mailer,
		MailModeFn: func() string { return mailMode },
		OAuthInfo: func() []settingshttp.OAuthProviderInfo {
			out := make([]settingshttp.OAuthProviderInfo, 0, len(oauthNames))
			for _, n := range oauthNames {
				out = append(out, settingshttp.OAuthProviderInfo{
					Name:        n,
					CallbackURL: oauthBase + "/auth/oauth/" + n + "/callback",
				})
			}
			return out
		},
		Log: log,
	})

	// LC-4 operator queue + LC-9 compliance surface: both behind the
	// platform-admin guard, same injected-guard discipline as settingshttp.
	billinghttp.MountAdmin(mux, billinghttp.AdminDeps{Svc: billingSvc, Guard: adminhttp.PlatformAdminGuard()})
	legalhttp.MountAdmin(mux, legalhttp.AdminDeps{Mod: legalMod, Svc: legalMod.Service(), Guard: adminhttp.PlatformAdminGuard()})

	audithttp.Mount(mux, audithttp.Deps{Rec: auditor, WsMW: wsMW, Authz: authorizer})

	whkMembers := func(ctx context.Context, workspaceID, userID string) (string, bool, error) {
		m, ok, err := wsRepo.GetMember(ctx, workspaceID, userID)
		if err != nil || !ok {
			return "", false, err
		}
		return m.Role, true, nil
	}
	webhookhttp.Mount(mux, webhookhttp.Deps{Service: whkSvc, MemberCheck: whkMembers, Log: log, Authz: authorizer})

	// storage-walk #14 wiring: /uploads serving (read-only, safe defaults) +
	// a reference upload endpoint. Auth/policy live HERE in product code on
	// purpose — the framework ships the building blocks, not the policy.
	uploadsDir := os.Getenv("UPLOADS_DIR")
	if uploadsDir == "" {
		uploadsDir = "uploads"
	}
	uploadsStore, err := storagex.NewLocal(uploadsDir)
	if err != nil {
		log.Error("uploads store", "err", err)
		os.Exit(1)
	}
	mux.Handle("GET /uploads/", http.StripPrefix("", storagex.ServeUploads(uploadsStore)))
	mux.HandleFunc("POST /api/uploads/avatar", webx.P(func(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
		up, err := storagex.ParseUpload(r, 4<<20)
		if err != nil {
			if errors.Is(err, storagex.ErrUploadTooLarge) {
				webx.WriteError(w, http.StatusRequestEntityTooLarge, "E_PAYLOAD_TOO_LARGE", "file exceeds the 4MB limit", nil)
				return
			}
			webx.ErrValidation(w, "multipart body with a 'file' part required")
			return
		}
		if ct := up.ContentType; !strings.HasPrefix(ct, "image/") {
			webx.ErrValidation(w, "avatar must be an image (got "+ct+")")
			return
		}
		key := "avatars/" + p.UserID + "/" + time.Now().UTC().Format("20060102T150405") + path.Ext(up.Filename)
		obj, err := uploadsStore.Put(r.Context(), key, up.ContentType, bytes.NewReader(up.Data))
		if err != nil {
			webx.ErrInternal(w)
			return
		}
		webx.WriteJSON(w, http.StatusOK, map[string]any{"key": obj.Key, "url": uploadsStore.URL(obj.Key), "size": obj.Size})
	}))

	// --- Video studio (plan-agent-video-studio-architecture §4.3/§4.9): ---
	// assets live in their own store root (NOT the generic /uploads/ space —
	// downloads go through the domain's authorized Range handler only).
	videoDataDir := env("VIDEO_DATA_DIR", "data/video")
	videoStore, err := storagex.NewLocal(filepath.Join(videoDataDir, "assets"))
	if err != nil {
		log.Error("video store", "err", err)
		os.Exit(1)
	}
	videoTmpDir := env("VIDEO_TMP_DIR", filepath.Join(videoDataDir, "tmp"))
	if err := os.MkdirAll(videoTmpDir, 0o755); err != nil {
		log.Error("video tmp dir", "err", err)
		os.Exit(1)
	}

	// capx runtime: env-gated, inert when Chrome/ffmpeg are missing — every
	// consumer degrades to structured E_NOT_CONFIGURED, boot stays green.
	capxRuntime, capxErr := capx.New(capx.Config{
		Enabled:    &mcpOn, // reuse the agent-facing gate: video studio is an agent-driven surface
		ChromePath: env("CAPX_CHROME_PATH", ""),
		FFMpegPath: env("CAPX_FFMPEG_PATH", ""),
	})
	if capxErr != nil {
		log.Warn("capx runtime degraded", "err", capxErr)
	}
	// Inject the runtime into the capx-tagged render pipeline (L3 smoke
	// finding F3: the var existed but was never assigned — every render
	// failed ErrNotConfigured 97ms in). main.go is the only production
	// assigner; CapxRuntime lives behind the capx build tag, so the default
	// build has no such symbol and pipeline callers are tag-gated to match.
	videorender.SetCapxRuntime(capxRuntime)
	// Same injection for the single-frame snapshot bridge (video_snapshot_frame
	// MCP tool — the agent's visual feedback loop): the capx build stores a
	// runtime-backed cached snapshotter, the default build discards it and the
	// tool degrades to E_NOT_CONFIGURED. Tag-portable like SetCapxRuntime.
	videorender.SetSnapshotter(capxRuntime)

	videoMembership := videomcpMemberAdapter{repo: wsRepo}
	videoAud := videoAuditAdapter{rec: auditor}
	videoPub := videoPublishAdapter{hub: hub}
	videoQuota := videoQuotaAdapter{svc: quotaSvc}
	videoEnq := &videoEnqueuer{}

	videoSvc := videoapp.NewProjectService(pool, videoapp.Ports{
		Enqueue:    videoEnq,
		Publish:    videoPub,
		Audit:      videoAud,
		Quota:      videoQuota,
		Membership: videoMembership,
		Store:      videoStore,
		Cap:        videoCapProbe{rt: capxRuntime},
	}, log)

	// 剧本→视频生成器（2026-11 批次）：scriptgen/template 注入（app 不能
	// import scriptgen/template——包环，函数注入是官方对接点）。未注入时
	// POST compose 返回 503 E_NOT_CONFIGURED、模板目录返回空目录。
	videoSvc.WithScriptComposer(scriptgen.Prepare, func(script string) ([]videoapp.CardInfo, error) {
		cis, err := scriptgen.SplitCardInfos(script)
		if err != nil {
			return nil, err
		}
		out := make([]videoapp.CardInfo, 0, len(cis))
		for _, ci := range cis {
			out = append(out, videoapp.CardInfo{Role: ci.Role, Title: ci.Title})
		}
		return out, nil
	})
	videoSvc.WithTemplateCatalog(
		func() []videoapp.TemplateCatalogEntry {
			var out []videoapp.TemplateCatalogEntry
			for _, tp := range template.Catalog() {
				out = append(out, videoapp.TemplateCatalogEntry{
					Key: tp.Key, Name: tp.Name, Description: tp.Description,
					CanvasW: tp.CanvasW, CanvasH: tp.CanvasH, FPS: tp.FPS, SafeMargin: tp.SafeMargin,
				})
			}
			return out
		},
		func() []videoapp.ThemeCatalogEntry {
			var out []videoapp.ThemeCatalogEntry
			for _, th := range template.ThemeCatalog() {
				out = append(out, videoapp.ThemeCatalogEntry{
					Key: th.Key, Name: th.Name, BG: th.BG, FG: th.FG,
					Accent: th.Accent, Muted: th.Muted, FontScale: th.FontScale,
				})
			}
			return out
		})

	videoSvcForAccess = videoSvc
	// wsMW fills principal.WorkspaceID from the X-Workspace-Id header
	// (delivery-audit-video-studio §3 N2: without it every session/PAT
	// request carries an empty workspace and dies at membership); authz
	// gates the registered video:* role keys per route.
	videohttp.Mount(mux, videohttp.Deps{Svc: videoSvc, Store: videoStore, Authz: authorizer}, wsMW)

	// video render worker: dedicated river client on the "video" queue
	// (MaxWorkers env-tunable, default 1). The client starts/drains inside a
	// workers.Runner wrapper mirroring schedule.NewFireRunner.
	videoWorkers := river.NewWorkers()
	videoWorker := videorender.NewWorker(videorender.WorkerDeps{
		Pool:         pool,
		Store:        videoStore,
		Publish:      videoPub,
		Audit:        videoAud,
		QuotaRelease: videoQuota,
		Log:          log,
		TmpDir:       videoTmpDir,
	})
	river.AddWorker(videoWorkers, videoWorker)
	// Lifecycle knobs (delivery-audit-video-studio §4 P1 — all three were
	// left at river defaults before: JobTimeout 1min killed every >60s
	// render into a retry-discard loop, MaxAttempts defaulted to 25, and an
	// unset SoftStopTimeout made drain cancel in-flight work instantly):
	JobTimeout := envDuration("CAPX_RENDER_JOB_TIMEOUT", 15*time.Minute)
	videoClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues: map[string]river.QueueConfig{
			videorender.QueueName: {MaxWorkers: envInt("CAPX_RENDER_WORKERS", 1)},
		},
		Workers: videoWorkers,
		// One render of ~30s footage takes 2–4min of frame capture; give the
		// job its own budget, far above the API default of 1 minute.
		JobTimeout: JobTimeout,
		// Two attempts, then discard: renders are snapshot-deterministic, a
		// second failure is not transient (quota is released by the worker).
		MaxAttempts: 2,
		// Soft stop lets in-flight captures finish (or hit JobTimeout) before
		// cancellation propagates; the runner's stop window below must cover
		// this plus persistence margin.
		SoftStopTimeout: JobTimeout,
		// Rescue a stuck job (process died mid-render without cleanup) after
		// JobTimeout + 15min, comfortably above one full render.
		RescueStuckJobsAfter: JobTimeout + 15*time.Minute,
	})
	if err != nil {
		log.Error("video river client", "err", err)
		os.Exit(1)
	}
	videoEnq.client = videoClient
	// Render drain window = SoftStopTimeout (job-timeout sized) + margin —
	// NOT the shared 45s events window: a 2–4min render killed at 45s is
	// interrupted, retried, and interrupted again until discarded
	// (delivery-audit-video-studio §4 P1).
	wk.Add(&videoRunner{client: videoClient,
		StopWait: envDuration("CAPX_RENDER_JOB_TIMEOUT", 15*time.Minute) + time.Minute})
	videoWorker.SweepOrphans(ctx)
	// Reconciler (round4 §4 P5 / F-WKR-01): closes queued/running renders
	// whose river job already reached discarded/cancelled — releases quota on
	// the frozen quota_period, audits, pushes. Same lifecycle as the worker;
	// CAPX_RECONCILE_INTERVAL tunes the tick (default 5min).
	wk.Add(videorender.NewReconciler(videorender.ReconcilerDeps{
		Pool:         pool,
		QuotaRelease: videoQuota,
		Publish:      videoPub,
		Audit:        videoAud,
		Log:          log,
	}, 0))

	// video MCP tools: registered on the same server as devx (the registration
	// callback captured the server above). No-op when PLOYKIT_MCP_ENABLED=0.
	if mcpServer != nil {
		videomcp.RegisterTools(mcpServer, videomcp.Deps{
			Svc: videoSvc,
			Cap: videoCapProbe{rt: capxRuntime},
			// video_snapshot_frame 的两条腿：Store 内联资产 data URI（与渲染
			// 路径同款零网络文档）；Snapshot 读 videorender 的桥接槽（capx
			// 构建有真实现，stub 构建为 nil → 工具报 E_NOT_CONFIGURED）。
			Store:    videoStore,
			Snapshot: videorender.SnapshotterFor,
			// video_render_frames（批G G-07 成品抽帧眼）的第三条腿：FrameExtract
			// 读 videorender 的抽帧桥接槽（SetSnapshotter 一并安装，同一个
			// capx.Runtime；stub 构建为 nil → 工具报 E_NOT_CONFIGURED）。
			FrameExtract: videorender.FrameExtractorFor,
		})
	}

	mux.HandleFunc("GET /config", webx.ConfigHandler(webx.ConfigDeps{
		OAuthProviders:  func() []string { return oauthNames },
		BillingChannels: channels.OrderedNames,
		Extra: func() map[string]any {
			eff, err := siteSettings.Effective(context.Background())
			if err != nil {
				log.Error("config extra: site settings effective", "err", err)
				return nil
			}
			out := make(map[string]any, len(eff)+1)
			for k, v := range eff {
				// UP-1: /config is public — sensitive keys (smtp_pass,
				// registered resend_api_key) must never ride along, not even
				// masked. Store-level check so registry keys are covered too.
				if siteSettings.IsSensitive(k) {
					continue
				}
				out[k] = v
			}

			out["mail_mode"] = mailMode
			// LC-6: the legal block rides the existing public /config —
			// products render their copy placeholders (entity, jurisdiction,
			// live payment-processor name, doc versions) from here instead of
			// hardcoding them into i18n files.
			out["legal"] = legalMod.PublicConfig(context.Background())
			return out
		},
	}))

	health := webx.NewHealth()
	health.AddCheck("db", func(ctx context.Context) error {
		pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		return db.Ping(pingCtx)
	})
	health.AddCheck("workers", func(_ context.Context) error {
		if wk.AllHealthy() {
			return nil
		}
		return errors.New("worker crashed or not started")
	})
	mux.HandleFunc("GET /healthz", health.Liveness())
	mux.HandleFunc("GET /readyz", health.Readiness())

	mux.HandleFunc("GET /debug/pool", func(w http.ResponseWriter, r *http.Request) {
		p := webx.PrincipalFromRequest(r)
		if p == nil {
			webx.ErrUnauthenticated(w, "authentication required")
			return
		}
		if !p.IsPlatformAdmin && env("DEV_DEBUG_POOL", "") != "1" {
			webx.ErrForbidden(w, "platform admin required")
			return
		}
		acquired, idle, total := webx.PoolStats(pool)
		webx.WriteJSON(w, http.StatusOK, map[string]int32{
			"acquired": acquired, "idle": idle, "total": total,
		})
	})

	csrfMW := webx.CSRFConditional(
		&webx.CSRFConfig{
			Key:            webx.DeriveCSRFKey([]byte(sessCfg.SecretPepper)),
			TrustedOrigins: []string{frontendHost},

			// dev 放行回环任意端口：vite 端口漂移（5173→517x）不再全站写操作 403；生产必须精确枚举
			TrustLocalhostAnyPort: !production,

			ExemptPrefixes: []string{"/webhooks/billing/", "/mcp"},

			// ADR 0013 batch 3: CSRF 的 bearer 豁免只对"干净 bearer 传输"生效 —
			// 同请求带着会话 cookie 即为 mixed，落入 CSRF 检查
			SessionCookieName: authCfg.CookieName,
		}, authCfg.Secure)

	spaCsp := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// GA4（ga4_measurement_id 配置后启用）：gtag.js 脚本域 + 事件收集域。
			// 静态放行——未配置统计时没有任何请求会打这两个域，CSP 放行是无害的。
			w.Header().Set("Content-Security-Policy",
				"default-src 'self'; style-src 'self' 'unsafe-inline'; "+
					"script-src 'self' https://www.googletagmanager.com; "+
					"connect-src 'self' ws: wss: https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; "+
					"img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
			next.ServeHTTP(w, r)
		})
	}

	// Traffic observation (visitor walkthrough, batch B): counts the public
	// surface by bot class × serving tier × status class. No PII, no per-request
	// storage — the tier comes from renderx's X-Renderx-Tier response header.
	trafficMW := mnt.Traffic(metrics.TrafficConfig{Header: renderx.HeaderTier})
	renderH, engPool, renderOK, err := renderxHandler(ctx, mux, pool, env("RENDERX_CACHE_DIR", "renderx-cache"), trafficMW)
	if err != nil {
		log.Error("renderx init", "err", err)
		os.Exit(1)
	}
	if renderOK {
		defer engPool.Close()
		mux.Handle("/", trafficMW(spaCsp(webx.Gzip(renderH))))
		log.Info("renderx enabled", "cache_dir", env("RENDERX_CACHE_DIR", "renderx-cache"))
	} else {
		log.Warn("renderx 未启用：embed 缺 ssr-bundle.js（构建链：cd web && npx vite build && go run ./cmd/render prerender）")
		mux.Handle("/", trafficMW(spaCsp(webx.Gzip(frontendHandler()))))
	}

	var limiter webx.Limiter = webx.FailOpenLimiter{}
	if addr := env("REDIS_ADDR", ""); addr != "" {
		if rclient, ok := redisx.New(ctx, addr); ok {
			limiter = redisx.NewGCRALimiter(rclient)
			log.Info("rate limit backend: redis GCRA", "addr", addr)
		} else {
			log.Warn("REDIS_ADDR set but redis unreachable, rate limit fail-open", "addr", addr)
		}
	}
	rlPerUser, rlPerIP, rlAllowRaw, err := siteSettings.RateLimits(ctx)
	if err != nil {
		log.Error("rate limit settings", "err", err)
		os.Exit(1)
	}
	log.Info("rate limits", "per_user_per_min", rlPerUser, "per_ip_per_min", rlPerIP, "allowlist", rlAllowRaw)

	var rlAllowNets []*net.IPNet
	rlAllowIPs := map[string]bool{}
	for _, e := range rlAllowRaw {
		if _, cidr, err := net.ParseCIDR(e); err == nil {
			rlAllowNets = append(rlAllowNets, cidr)
		} else if ip := net.ParseIP(e); ip != nil {
			rlAllowIPs[ip.String()] = true
		}
	}
	allowlisted := func(r *http.Request) bool {
		ip := net.ParseIP(webx.ClientIP(r))
		if ip == nil {
			return false
		}
		if rlAllowIPs[ip.String()] {
			return true
		}
		for _, n := range rlAllowNets {
			if n.Contains(ip) {
				return true
			}
		}
		return false
	}

	withAllowlist := func(wrap func(http.Handler) http.Handler) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			gated := wrap(next)
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if allowlisted(r) {
					next.ServeHTTP(w, r)
					return
				}
				gated.ServeHTTP(w, r)
			})
		}
	}

	pathGate := func(wrap func(http.Handler) http.Handler, prefixes ...string) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			gated := wrap(next)
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				for _, p := range prefixes {
					if strings.HasPrefix(r.URL.Path, p) {
						gated.ServeHTTP(w, r)
						return
					}
				}
				next.ServeHTTP(w, r)
			})
		}
	}
	// 资产上传走 BodyLimitExcept 豁免（AGENTS.md 挂载陷阱 #2）：pathGate 的
	// /api/ 1MiB 门罩住 POST /api/video/assets（multipart）。豁免语义 = 绕过
	// 1MiB reader，由 service.UploadLimit 上限校验兜住真实大小（视频资产：
	// 一首 3 分钟 BGM ≈3MB，700KB MCP 路径与 1MiB REST 门双双进不来——批G
	// G-01d）。50MiB 上限靠 webx.BodyLimitExcept 单层（绝不嵌套两层
	// MaxBytesReader——有效上限取最小值）。豁免后缀需同步豁免请求超时：
	// 读大 body 消耗请求超时预算（陷阱 #2 配对规则），Timeouts 表给
	// /api/video/assets 单独 120s（multi-tier 最长前缀优先；上传 handler
	// 自身仍有 multipart 解析与 storagex 限额兜底）。
	videoAssetLimit := webx.BodyLimitExcept(50<<20, "/api/video/assets")
	apiBodyLimitMW := pathGate(videoAssetLimit, "/api/", "/auth/", "/dev/", "/mcp")

	authRateLimitMW := func(next http.Handler) http.Handler { return next }
	if rlPerIP > 0 {
		authRateLimitMW = pathGate(
			withAllowlist(webx.RateLimit(limiter, "auth", rlPerIP, func(r *http.Request) string { return webx.ClientIP(r) })),
			"/auth/")
	}

	apiUserRateLimitMW := func(next http.Handler) http.Handler { return next }
	if rlPerUser > 0 {
		apiUserRateLimitMW = pathGate(
			withAllowlist(webx.RateLimit(limiter, "api_user", rlPerUser, func(r *http.Request) string {
				if p := webx.PrincipalFromRequest(r); p != nil && p.UserID != "" {
					return p.UserID
				}
				return "anon:" + webx.ClientIP(r)
			})),
			"/api/")
	}

	// /mcp joins /ws on the timeout exemption: MCP sessions (and tool calls
	// over the streamable transport) outlive the 5s default — pitfall #1 of
	// the non-browser mounting checklist. Timeouts is the multi-tier form
	// (longest prefix wins, 0 = fully exempt); products needing a middle tier
	// (e.g. a 30s generation route) add entries here instead of nesting a
	// second TimeoutExcept, whose outer cap can kill a handler that manages
	// its own internal deadline.
	// /api/video/assets gets a 120s tier (G-01d pairing rule): reading a
	// large multipart body consumes the request-timeout budget, and the 5s
	// base would bisect slow BGM uploads regardless of the raised body limit.
	chainInner := webx.Timeouts(5*time.Second, map[string]time.Duration{
		"/ws":               0,
		"/mcp":              0,
		"/api/video/assets": 120 * time.Second,
	})(
		webx.CORS([]string{frontendOrigin}, true)(
			csrfMW(
				webx.Recover(log)(

					webx.Authenticate(&authCfg, idRepo, idRepo)(apiUserRateLimitMW(mux))))))
	handler := mnt.Middleware(authRateLimitMW(webx.PrincipalHolder()(
		webx.RequestIDMiddleware(
			// LC-3: client IP + metadata into ctx — the legal acceptance
			// rows read them as evidence; same trusted-proxy semantics as
			// AccessLog (none here: direct dev exposure).
			webx.ClientMetadata()(
				webx.AccessLog(log)(
					webx.SecurityHeaders(
						apiBodyLimitMW(chainInner))))))))

	wk.Add(&webhookworkers.DeliveryWorker{Service: whkSvc})
	wk.Add(&notifyworkers.RetentionWorker{Repo: notifyRepo})
	wk.Add(&billingworkers.ExpiryWorker{Service: billingSvc})
	wk.Add(&billingworkers.OrderExpiryWorker{Service: billingSvc})
	wk.Add(&billingworkers.MeteredOverageWorker{Billing: billingSvc, Usage: quotaSvc.Usage, Every: time.Hour})
	wk.Add(&quotaworkers.ExpiryWorker{Service: quotaSvc})

	wk.Add(&quotaworkers.RefreshWorker{Service: quotaSvc})
	wk.Add(&schedule.ScannerWorker{Repo: schedule.NewPGRepo(pool), Fire: scheduleSvc.Fire})
	wk.Add(schedule.NewFireRunner(fireClient))

	wk.Add(&attemptsCleanupWorker{Repo: idRepo})

	wk.Add(&auditworkers.RetentionWorker{Table: &pgpart.Table{
		Pool: pool, Parent: "audit_event",
		RetentionMonths: envInt("AUDIT_RETENTION_MONTHS", pgpart.DefaultRetentionMonths),
	}})
	wk.Add(&analyticsworkers.RetentionWorker{Table: &pgpart.Table{
		Pool: pool, Parent: "analytics_event",
		RetentionMonths: envInt("ANALYTICS_RETENTION_MONTHS", pgpart.DefaultRetentionMonths),
	}})
	go wk.Start(ctx)

	addr := env("ADDR", ":8030")
	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Info("listening", "addr", addr, "dev_code", sessCfg.DevCode)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("serve", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	// Drain ≥ events soft-stop (30s) + margin (15s): a shorter window
	// force-kills in-flight event handlers mid-work (the DrainWindowCheck in
	// the doctor verifies this contract).
	wk.Drain(45 * time.Second)
	log.Info("bye")
}

// stdlibDB exposes the pool over database/sql for checks that want plain SQL
// (the doctor's river schema probe) without dragging pgx into devx.
func stdlibDB(pool *pgxpool.Pool) *sql.DB {
	return stdlib.OpenDB(*pool.Config().ConnConfig)
}

type attemptsCleanupWorker struct {
	Repo  *identitypg.Repo
	Every time.Duration
}

func (w *attemptsCleanupWorker) Name() string { return "identity_attempts_cleanup" }

func (w *attemptsCleanupWorker) Run(ctx context.Context) error {
	if w.Every <= 0 {
		w.Every = 24 * time.Hour
	}
	ticker := time.NewTicker(w.Every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:

			if err := w.Repo.CleanupAttempts(ctx, time.Now().UTC().Add(-30*24*time.Hour)); err != nil {
				slog.Warn("worker round failed, will retry next tick", "worker", w.Name(), "err", err)
			}
		}
	}
}

type analyticsRecentAdapter struct{ svc *analyticsapp.TrackService }

func (a analyticsRecentAdapter) Recent(ctx context.Context, eventType string, limit int) ([]adminapp.AnalyticsEventRow, error) {
	var rows []analyticsapp.EventRow
	var err error
	if eventType == "" {
		rows, err = a.svc.Recent(ctx, limit)
	} else {
		rows, err = a.svc.RecentByType(ctx, eventType, limit)
	}
	if err != nil {
		return nil, err
	}
	out := make([]adminapp.AnalyticsEventRow, len(rows))
	for i, r := range rows {
		out[i] = adminapp.AnalyticsEventRow{
			ID: r.ID, WorkspaceID: r.WorkspaceID, UserID: r.UserID,
			Type: r.Type, EntityType: r.EntityType, EntityID: r.EntityID,
			Payload: r.Payload, CreatedAt: r.CreatedAt,
		}
	}
	return out, nil
}

var _ adminapp.AnalyticsRecentEvents = analyticsRecentAdapter{}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := parts[:0]
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// --- video studio adapters (plan-agent-video-studio-architecture §4.3/§4.8): ---
// thin bridges from the domain ports to the framework services. All wiring
// lives here in product code; the domain only sees interfaces.

// videoCapProbe adapts capx.Runtime to the domain's CapProbe port (the
// domain must not import capx).
type videoCapProbe struct{ rt *capx.Runtime }

func (p videoCapProbe) CapAvailable() bool { return p.rt != nil && p.rt.Available() }

type videomcpMemberAdapter struct{ repo *workspacepg.Repo }

func (a videomcpMemberAdapter) IsMember(ctx context.Context, workspaceID, userID string) (bool, error) {
	_, ok, err := a.repo.GetMember(ctx, workspaceID, userID)
	return ok, err
}

type videoAuditAdapter struct{ rec *auditrec.Recorder }

func (a videoAuditAdapter) RecordTx(ctx context.Context, tx pgx.Tx, workspaceID *string, userID string, action, resourceType, resourceID string, meta map[string]any) error {
	return a.rec.RecordTx(ctx, tx, workspaceID, &webx.Principal{UserID: userID}, action, resourceType, resourceID, meta)
}

func (a videoAuditAdapter) Record(ctx context.Context, workspaceID *string, userID string, action, resourceType, resourceID string, meta map[string]any) {
	// Worker-side lifecycle events record the triggering user as a plain
	// principal (session-shaped; the recorder marks actor from source and
	// there is no worker source — the action name carries the context).
	a.rec.Record(ctx, workspaceID, &webx.Principal{UserID: userID}, action, resourceType, resourceID, meta)
}

type videoPublishAdapter struct{ hub *wsx.Hub }

func (a videoPublishAdapter) BroadcastEvent(ctx context.Context, event string, payload []byte, eventID string) error {
	// The domain port carries no scope; every video frame is scoped to
	// "video:<projectID>" (§4.8), and both payloads embed project_id.
	var pl struct {
		ProjectID string `json:"project_id"`
	}
	if err := json.Unmarshal(payload, &pl); err != nil || pl.ProjectID == "" {
		// Unscoped fallback would fan out to nobody — treat as a wiring bug.
		return fmt.Errorf("video publish: payload missing project_id for %s", event)
	}
	return a.hub.BroadcastEvent(ctx, "video:"+pl.ProjectID, event, payload, eventID)
}

type videoQuotaAdapter struct{ svc *quota.Service }

func (a videoQuotaAdapter) ConsumeWithTx(ctx context.Context, tx pgx.Tx, workspaceID, key string, n int64, now time.Time, idemKey string) error {
	_, err := a.svc.ConsumeWithTx(ctx, tx, workspaceID, key, n, now, quota.ConsumeOpts{IdemKey: idemKey})
	return err
}

func (a videoQuotaAdapter) ReleaseTx(ctx context.Context, tx pgx.Tx, workspaceID, key string, n int64, period string) error {
	return a.svc.ReleaseTx(ctx, tx, workspaceID, key, n, period)
}

func (a videoQuotaAdapter) Release(ctx context.Context, workspaceID, key string, n int64, now time.Time) error {
	return a.svc.Release(ctx, workspaceID, key, n, now)
}

// ReleasePeriod satisfies the render worker's QuotaReleasePort: releases on
// the consumption-time period (period-fixed release, audit §4 P3).
func (a videoQuotaAdapter) ReleasePeriod(ctx context.Context, workspaceID, key string, n int64, period string) error {
	return a.svc.ReleasePeriod(ctx, workspaceID, key, n, period)
}

type videoEnqueuer struct{ client *river.Client[pgx.Tx] }

func (e *videoEnqueuer) InsertTx(ctx context.Context, tx pgx.Tx, args any, opts *river.InsertOpts) error {
	ra, ok := args.(videoapp.RenderArgs)
	if !ok {
		return fmt.Errorf("video enqueuer: unexpected args %T", args)
	}
	_, err := e.client.InsertTx(ctx, tx, ra, opts)
	return err
}

// newVideoRunner wraps the video river client in a workers.Runner (start on
// boot, drain on shutdown) — same shape as schedule.NewFireRunner.
type videoRunner struct {
	client   *river.Client[pgx.Tx]
	StopWait time.Duration
}

func newVideoRunner(client *river.Client[pgx.Tx]) *videoRunner { return &videoRunner{client: client} }

func (r *videoRunner) Name() string { return "video_render_queue" }

func (r *videoRunner) Run(ctx context.Context) error {
	if err := r.client.Start(ctx); err != nil {
		return err
	}
	<-ctx.Done()
	// Render-specific window: the client's SoftStopTimeout (job-timeout
	// sized, default 15min) + 1min persistence margin. The shared 45s events
	// window does NOT fit minute-scale captures (§8.1 of the video plan).
	wait := r.StopWait
	if wait == 0 {
		wait = envDuration("CAPX_RENDER_JOB_TIMEOUT", 15*time.Minute) + time.Minute
	}
	stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), wait)
	defer cancel()
	return r.client.Stop(stopCtx)
}

// videoSvcForAccess backs hub.Authorize for the "video" scope (§4.8): the
// closure above reads it; it is assigned right after the video service is
// constructed (the hub is built earlier in boot). Before assignment the
// closure fails closed (nil check) — no subscriptions, no leak.
var videoSvcForAccess *videoapp.ProjectService
