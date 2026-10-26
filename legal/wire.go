package legal

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/settings"
)

// SettingsStore is the settings surface the legal module consumes; it is the
// exact method subset *settings.Store already implements, as an interface so
// hermetic tests substitute a fake (pass the real store unchanged).
type SettingsStore interface {
	RegisterKeys(specs ...settings.KeySpec) error
	Effective(ctx context.Context) (map[string]string, error)
	// EffectiveKey is the single-key read the boot-time reconciliation uses:
	// unlike Effective it cannot fail because of an UNRELATED sealed key
	// (settings.Store.EffectiveKey doc — the no-SEAL_KEY amplification bug).
	EffectiveKey(ctx context.Context, key string) (string, error)
}

// Config wires the legal module. Pool and Store are required; everything
// else is optional and silently degrades: without Auditor the re-acceptance
// action skips the audit trail, without ProcessorName / SiteURL the
// corresponding placeholders resolve to empty strings (the compliance card
// red-lights them). ProcessorName is a CALLBACK on purpose — this package
// must never import billing; the integrator passes e.g. the current
// merchant-of-record display name, and switching payment channels updates
// every legal text that references the processor without a code change.
type Config struct {
	Pool  *pgxpool.Pool
	Store SettingsStore
	Log   *slog.Logger

	// Auditor optionally receives re-acceptance audit records
	// (*audit.Recorder satisfies the interface).
	Auditor Auditor

	// ProcessorName resolves the payment_processor_name placeholder live
	// (e.g. "Waffo Pancake"); nil = always empty.
	ProcessorName func() string

	// SiteURL resolves the site_url placeholder live; nil = always empty.
	SiteURL func() string
}

// Module is everything legal.Wire mounts. It is inert by itself — the
// integrator decides which pieces to attach: Hooks() onto the identity
// services (via identity.ChainHooks when other hooks already occupy the
// slots), Service() onto the re-acceptance/admin handlers, PublicConfig
// onto the public /config payload.
type Module struct {
	repo          AcceptanceRepo
	store         SettingsStore
	processorName func() string
	siteURL       func() string
	log           *slog.Logger
	service       *Service
}

// Wire is the one-line product integration (LC-1, the
// provisioning.PersonalWorkspace precedent): it registers the whole
// legal_* settings key group on the store, reconciles every registered doc
// against the legal_billing_model setting (fail-fast — call RegisterDocs
// BEFORE Wire so the reconciliation sees them), and returns the mountable
// pieces. A product that never calls Wire keeps today's behavior exactly.
func Wire(cfg Config) (*Module, error) {
	if cfg.Pool == nil {
		return nil, errors.New("legal: Config.Pool is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("legal: Config.Store is required")
	}
	log := cfg.Log
	if log == nil {
		log = slog.Default()
	}
	if err := cfg.Store.RegisterKeys(KeySpecs()...); err != nil {
		return nil, fmt.Errorf("legal: register settings keys: %w", err)
	}
	if err := reconcileBillingModel(cfg.Store); err != nil {
		return nil, err
	}
	repo := NewAcceptanceRepo(cfg.Pool)
	m := &Module{
		repo:          repo,
		store:         cfg.Store,
		processorName: cfg.ProcessorName,
		siteURL:       cfg.SiteURL,
		log:           log,
		service: &Service{
			repo:    repo,
			auditor: cfg.Auditor,
			log:     log,
			now:     time.Now,
		},
	}
	return m, nil
}

// reconcileBillingModel enforces the Waffo template's three-way billing
// chapter against the live site: with docs registered, the effective
// legal_billing_model (DB row > env LEGAL_BILLING_MODEL > default) must be
// set and match EVERY doc's declared BillingModel. A doc declaring v1 while
// the site sells v2 credits is a regulatory lie — better a boot error than a
// disputed chargeback (plan F8: the template checklist becomes automated).
func reconcileBillingModel(store SettingsStore) error {
	docs := RegisteredDocs()
	if len(docs) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Single-key read on purpose: Effective would fail wholesale when any
	// unrelated sealed key cannot unseal in this environment (no
	// PLOYKIT_SEAL_KEY), amplifying a mailer credential into refusing the
	// whole app startup (found live in the shuijing smoke).
	model, err := store.EffectiveKey(ctx, KeyBillingModel)
	if err != nil {
		return fmt.Errorf("legal: billing-model reconciliation: read %s: %w", KeyBillingModel, err)
	}
	model = strings.TrimSpace(model)
	if model == "" {
		return fmt.Errorf("legal: %s is unset while %d doc(s) are registered — set the key (or env LEGAL_BILLING_MODEL) to one of %s / %s / %s; the billing chapter and the live site must agree",
			KeyBillingModel, len(docs), BillingV1Subscription, BillingV2Credits, BillingV3Hybrid)
	}
	for _, d := range docs {
		if d.BillingModel != model {
			return fmt.Errorf("legal: billing model mismatch: %s = %q but doc %q (version %s) declares %q — fix the setting or the Doc; the billing chapter and the live site must agree",
				KeyBillingModel, model, d.Key, d.Version, d.BillingModel)
		}
	}
	return nil
}

// Service exposes the principal-facing and admin operations (Reaccept,
// AcceptancesByUser).
func (m *Module) Service() *Service { return m.service }

// SiteURL resolves the site_url placeholder live ("" when unwired) — the
// one Config input that is not part of the public /config legal block;
// products resolving their own copy call this alongside PublicConfig.
func (m *Module) SiteURL() string {
	if m.siteURL == nil {
		return ""
	}
	return strings.TrimSpace(m.siteURL())
}

// LegalPublic is the `legal` block of the public /config payload (LC-6,
// audit L6 — rides the existing endpoint, no new fetch surface). Unfilled
// keys render as empty strings on purpose: the admin compliance card
// red-lights exactly those gaps, and product legal pages substitute them.
type LegalPublic struct {
	EntityName    string      `json:"entity_name"`
	Jurisdiction  string      `json:"jurisdiction"`
	ProcessorName string      `json:"processor_name"`
	ContactEmail  string      `json:"contact_email"`
	Docs          []PublicDoc `json:"docs"`
}

// PublicDoc is one document's published identity inside the legal block.
type PublicDoc struct {
	Key           string `json:"key"`
	Version       string `json:"version"`
	EffectiveFrom string `json:"effective_from"`
}

// PublicConfig resolves the legal block live: settings values (DB row >
// env > default, hot-reloaded per request), the processor-name callback,
// and the registered docs' versions and effective dates. A settings read
// failure degrades honestly: the value fields stay empty, the docs list
// still publishes, and the error is logged — a public config endpoint must
// answer, and the compliance card surfaces the gap.
func (m *Module) PublicConfig(ctx context.Context) LegalPublic {
	out := LegalPublic{Docs: publicDocs()}
	if m.processorName != nil {
		out.ProcessorName = strings.TrimSpace(m.processorName())
	}
	eff, err := m.store.Effective(ctx)
	if err != nil {
		m.log.Error("legal: public config: read effective settings", "err", err)
		return out
	}
	out.EntityName = eff[KeyEntityName]
	out.Jurisdiction = eff[KeyJurisdiction]
	out.ContactEmail = eff[KeyContactEmail]
	return out
}

func publicDocs() []PublicDoc {
	docs := RegisteredDocs()
	out := make([]PublicDoc, 0, len(docs))
	for _, d := range docs {
		out = append(out, PublicDoc{
			Key:           d.Key,
			Version:       d.Version,
			EffectiveFrom: d.EffectiveFrom.UTC().Format("2006-01-02"),
		})
	}
	return out
}
