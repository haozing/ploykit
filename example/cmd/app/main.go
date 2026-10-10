package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

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
	billinghttp "github.com/haozing/ploykit/billing/adapters/http"
	billingpg "github.com/haozing/ploykit/billing/adapters/pgrepo"
	stripe "github.com/haozing/ploykit/billing/adapters/stripe"
	billingapp "github.com/haozing/ploykit/billing/app"
	"github.com/haozing/ploykit/identity"
	identityhttp "github.com/haozing/ploykit/identity/adapters/http"
	oauthgh "github.com/haozing/ploykit/identity/adapters/oauth/github"
	oauthgoogle "github.com/haozing/ploykit/identity/adapters/oauth/googleoidc"
	oidcfed "github.com/haozing/ploykit/identity/adapters/oauth/oidcfed"
	identitypg "github.com/haozing/ploykit/identity/adapters/pgrepo"
	identityapp "github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/migrations"
	bellog "github.com/haozing/ploykit/notify/adapters/bell"
	emaildev "github.com/haozing/ploykit/notify/adapters/email/emaildev"
	notifysmtp "github.com/haozing/ploykit/notify/adapters/email/smtp"
	notifyhttp "github.com/haozing/ploykit/notify/adapters/http"
	notifyapp "github.com/haozing/ploykit/notify/app"
	"github.com/haozing/ploykit/platform/egressx"
	"github.com/haozing/ploykit/platform/events"
	logx "github.com/haozing/ploykit/platform/logx"
	"github.com/haozing/ploykit/platform/metrics"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/pgpart"
	"github.com/haozing/ploykit/platform/redactx"
	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/platform/workers"
	"github.com/haozing/ploykit/platform/wsx"

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

	"myproduct/internal/blog"
	"myproduct/internal/eventsdemo"
	"myproduct/internal/task"
)

//go:embed migrations/*.sql
var productMigrations embed.FS

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
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

func assembleMailer(log *slog.Logger) (mailerChannel, string) {
	if host := env("SMTP_HOST", ""); host != "" {
		return notifysmtp.New(notifysmtp.Config{
			Host:     host,
			Port:     envInt("SMTP_PORT", 587),
			Username: env("SMTP_USER", ""),
			Password: env("SMTP_PASS", ""),
			From:     env("SMTP_FROM", "no-reply@localhost"),
		}, log), settingshttp.MailModeSMTP
	}
	log.Warn("SMTP_HOST not set; mail channel degraded to emaildev (log-only) — set SMTP_HOST/PORT/USER/PASS/FROM to enable real email")
	return emaildev.New(), settingshttp.MailModeDev
}

func redactAttr(_ []string, a slog.Attr) slog.Attr {
	if a.Value.Kind() == slog.KindString {
		a.Value = slog.StringValue(redactx.String(a.Value.String()))
	}
	return a
}

func main() {

	log := logx.New(logx.Options{
		Level:       env("LOG_LEVEL", "info"),
		Format:      env("LOG_FORMAT", ""),
		ReplaceAttr: redactAttr,
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
	log.Info("migrations applied")

	siteSettings, err := settings.Bootstrap(pool, os.Getenv)
	if err != nil {
		log.Error("settings bootstrap", "err", err)
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

	mailer, mailMode := assembleMailer(log)
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
	roles := authz.DefaultRoles().Clone()
	roles.Grant(authz.RoleOwner, "tasks:read", "tasks:write", "tasks:delete_own", "schedules:manage")
	roles.Grant(authz.RoleAdmin, "tasks:read", "tasks:write", "tasks:delete_own", "schedules:manage")
	roles.Grant(authz.RoleMember, "tasks:read", "tasks:write")
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
	fedOpts := []identityapp.FedOption{}
	if secrets != nil {
		fedOpts = append(fedOpts, identityapp.WithSecrets(secrets))
	}

	fedSvc := identityapp.NewFedService(idRepo, wsRepo.FindWorkspaceIDBySlug, oidcfed.NewResolver(), now, fedOpts...).
		WithSecureCookie(authCfg.Secure)

	sessions.WithHooks(identity.IdentityHooks{

		AfterRegister: func(_ context.Context, _ pgx.Tx, userID string) error {
			log.Info("welcome", "uid", userID)
			return nil
		},
	})

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

	channels := billingapp.NewChannelRegistry()
	if k := env("STRIPE_SECRET_KEY", ""); k != "" {
		channels.Register(stripe.New(k, env("STRIPE_WEBHOOK_SIGNING_KEY", "")))
	}
	channels.Register(&billingapp.ManualChannel{InfoURL: env("BILLING_MANUAL_INFO_URL", "")})
	billingRepo := billingpg.New(pool)
	billingSvc := billingapp.NewBillingService(
		billingRepo,
		channels,
		billingapp.Config{Currency: "CNY", SuccessURL: env("BILLING_SUCCESS_URL", "http://localhost:5173/billing/success")},
		billingapp.BillingHooks{

			OnPaymentFailed: func(_ context.Context, workspaceID, orderID, reason string) error {
				log.Info("billing payment failed", "workspace", workspaceID, "order", orderID, "reason", reason)
				return nil
			},
		}, auditor, now, log,
	).
		WithMeterRegistry(billingRepo)

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

	idDeps := identityhttp.Deps{
		AuthCfg: authCfg, Sessions: idRepo, PATs: idRepo, Account: accountSvc,
		SessionsSvc: sessions, Tokens: identityapp.NewTokenService(idRepo, auditor, now),
		OAuth: oauthSvc, OAuthAppURL: env("APP_URL", "http://localhost:5173"),
		Fed: fedSvc,

		TrustedProxies: webx.ParseTrustedProxies(env("TRUSTED_PROXIES", "")),
	}
	identityhttp.Mount(mux, idDeps)

	// Destructive workspace operations (delete / transfer ownership) require a
	// password confirmation no older than 15 minutes — the reference wiring of
	// webx step-up: RequireRecentAuth ⇄ POST /auth/confirm-password. The
	// window is product policy: pick per mount site, there is no default.
	wsDeps := workspacehttp.Deps{Svc: workspaces, Members: wsRepo, Authz: authorizer,
		StepUp: webx.RequireRecentAuth(15 * time.Minute)}
	workspacehttp.Mount(mux, wsDeps)

	wsMW := workspacehttp.WorkspaceHeaderCtx(wsRepo)

	identityhttp.MountFedAdmin(mux, identityhttp.Deps{
		Fed: fedSvc,
		FedAdminGuard: func(next http.Handler) http.Handler {
			return wsMW(authz.Require(authorizer, "workspace:update")(next.ServeHTTP))
		},
	})

	billinghttp.Mount(mux, billinghttp.Deps{Svc: billingSvc, WsMW: wsMW, Authz: authorizer, Usage: quotaSvc.Usage})

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
		WithUsage(quotaSvc.Usage)
	billingOpsSvc := adminapp.NewBillingOpsService(adminSvc).
		WithBillingOps(&bridge.BillingOps{Svc: billingAdminSvc}).
		WithWebhookOps(&bridge.WebhookOps{Svc: whkSvc})
	adminhttp.MountBillingOps(mux, adminhttp.BillingOpsDeps{Svc: billingOpsSvc})

	settingshttp.MountAdmin(mux, settingshttp.AdminDeps{
		Store: siteSettings,
		Guard: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				p := webx.PrincipalFromRequest(r)
				if p == nil {
					webx.ErrUnauthenticated(w, "authentication required")
					return
				}
				if !p.IsPlatformAdmin {
					webx.ErrForbidden(w, "platform admin required")
					return
				}
				next.ServeHTTP(w, r)
			})
		},
		Mailer: mailer, MailMode: mailMode, Log: log,
	})

	audithttp.Mount(mux, audithttp.Deps{Rec: auditor, WsMW: wsMW, Authz: authorizer})

	whkMembers := func(ctx context.Context, workspaceID, userID string) (string, bool, error) {
		m, ok, err := wsRepo.GetMember(ctx, workspaceID, userID)
		if err != nil || !ok {
			return "", false, err
		}
		return m.Role, true, nil
	}
	webhookhttp.Mount(mux, webhookhttp.Deps{Service: whkSvc, MemberCheck: whkMembers, Log: log, Authz: authorizer})

	oauthNames := []string{}
	if oauthSvc != nil {
		oauthNames = oauthSvc.Names()
	}

	mux.HandleFunc("GET /config", webx.ConfigHandler(webx.ConfigDeps{
		OAuthProviders:  func() []string { return oauthNames },
		BillingChannels: channels.Names,
		Extra: func() map[string]any {
			eff, err := siteSettings.Effective(context.Background())
			if err != nil {
				log.Error("config extra: site settings effective", "err", err)
				return nil
			}
			out := make(map[string]any, len(eff)+1)
			for k, v := range eff {
				out[k] = v
			}

			out["mail_mode"] = mailMode
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

			ExemptPrefixes: []string{"/webhooks/billing/"},
		}, authCfg.Secure)

	spaCsp := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Security-Policy",
				"default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
			next.ServeHTTP(w, r)
		})
	}

	renderH, engPool, renderOK, err := renderxHandler(ctx, pool, env("RENDERX_CACHE_DIR", "renderx-cache"))
	if err != nil {
		log.Error("renderx init", "err", err)
		os.Exit(1)
	}
	if renderOK {
		defer engPool.Close()
		mux.Handle("/", spaCsp(gzipMW(renderH)))
		log.Info("renderx enabled", "cache_dir", env("RENDERX_CACHE_DIR", "renderx-cache"))
	} else {
		log.Warn("renderx 未启用：embed 缺 ssr-bundle.js（构建链：cd web && npx vite build && go run ./cmd/render prerender）")
		mux.Handle("/", spaCsp(gzipMW(frontendHandler())))
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
	apiBodyLimitMW := pathGate(webx.BodyLimit(1<<20), "/api/", "/auth/")

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

	chainInner := webx.TimeoutExcept(5*time.Second, "/ws")(
		webx.CORS([]string{frontendOrigin}, true)(
			csrfMW(
				webx.Recover(log)(

					webx.Authenticate(&authCfg, idRepo, idRepo)(apiUserRateLimitMW(mux))))))
	handler := mnt.Middleware(authRateLimitMW(webx.PrincipalHolder()(
		webx.RequestIDMiddleware(
			webx.AccessLog(log)(
				webx.SecurityHeaders(
					apiBodyLimitMW(chainInner)))))))

	wk.Add(&webhookworkers.DeliveryWorker{Service: whkSvc})
	wk.Add(&billingworkers.ExpiryWorker{Service: billingSvc})
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
	wk.Drain(10 * time.Second)
	log.Info("bye")
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
