package legal

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/audit"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/settings"
)

// Compile-time compatibility: the legal seams accept the real framework
// types even though hermetic tests drive them through fakes.
var (
	_ SettingsStore = (*settings.Store)(nil)
	_ Auditor       = (*audit.Recorder)(nil)
)

// --- fakes -----------------------------------------------------------------

type fakeStore struct {
	registered int
	regErr     error
	eff        map[string]string
	effErr     error
	effKeyErr  error
	// defaults models settings.Store's registered-key no-row path: when set,
	// EffectiveKey falls back to the registered spec's Default (env > Default)
	// for keys with no eff entry — the fresh-database shape the KeyBillingModel
	// Default exists for. Zero value models a bare custom store without that
	// fallback (the reconciliation stays fail-closed there).
	defaults bool
	specs    map[string]settings.KeySpec
}

func (f *fakeStore) RegisterKeys(specs ...settings.KeySpec) error {
	if f.regErr != nil {
		return f.regErr
	}
	if f.specs == nil {
		f.specs = map[string]settings.KeySpec{}
	}
	for _, s := range specs {
		f.specs[s.Key] = s
	}
	f.registered += len(specs)
	return nil
}

func (f *fakeStore) Effective(context.Context) (map[string]string, error) {
	if f.effErr != nil {
		return nil, f.effErr
	}
	if f.eff == nil {
		return map[string]string{}, nil
	}
	return f.eff, nil
}

// EffectiveKey mirrors settings.Store.EffectiveKey semantics for the fake:
// the single-key projection of eff, INDEPENDENT of effErr — a wholesale
// Effective failure (e.g. an unrelated sealed key without PLOYKIT_SEAL_KEY)
// must not fail the single-key read; that independence is the whole point
// of the boot-time reconciliation using EffectiveKey. effKeyErr models a
// genuine failure of the single-key read itself (DB down).
func (f *fakeStore) EffectiveKey(_ context.Context, key string) (string, error) {
	if f.effKeyErr != nil {
		return "", f.effKeyErr
	}
	if f.eff != nil {
		if v, ok := f.eff[key]; ok {
			return v, nil
		}
	}
	if f.defaults {
		if spec, ok := f.specs[key]; ok {
			return spec.Default, nil
		}
	}
	return "", nil
}

type fakeRepo struct {
	inserted      [][]Acceptance
	recorded      map[string]bool // "key\x00version" — mimics ON CONFLICT DO NOTHING
	unacceptedErr error
}

func newFakeRepo(recorded ...string) *fakeRepo {
	r := &fakeRepo{recorded: map[string]bool{}}
	for _, k := range recorded {
		r.recorded[k] = true
	}
	return r
}

func (r *fakeRepo) InsertAcceptances(_ context.Context, rows []Acceptance) error {
	if len(rows) == 0 {
		return nil
	}
	for _, row := range rows {
		k := row.DocKey + "\x00" + row.DocVersion
		if r.recorded[k] {
			continue // DO NOTHING: first evidence wins
		}
		r.recorded[k] = true
	}
	r.inserted = append(r.inserted, rows)
	return nil
}

func (r *fakeRepo) UnacceptedDocs(_ context.Context, userID string, docs []Doc) ([]Doc, error) {
	if r.unacceptedErr != nil {
		return nil, r.unacceptedErr
	}
	var missing []Doc
	for _, d := range docs {
		if !r.recorded[d.Key+"\x00"+d.Version] {
			missing = append(missing, d)
		}
	}
	_ = userID
	return missing, nil
}

func (r *fakeRepo) AcceptancesByUser(_ context.Context, _ string) ([]Acceptance, error) {
	return nil, nil
}

type fakeAuditor struct {
	calls []map[string]any
}

func (f *fakeAuditor) Record(_ context.Context, _ *string, _ *webx.Principal, action, resourceType, resourceID string, meta map[string]any) {
	f.calls = append(f.calls, map[string]any{
		"action": action, "resource_type": resourceType, "resource_id": resourceID, "meta": meta,
	})
}

// lazyPool builds a pool that never connects (pgx pools dial on first
// acquire): Wire only needs the handle for the repo it builds.
func lazyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), "host=127.0.0.1 port=1 user=legal_heredic dbname=legal_heredic sslmode=disable")
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

// clientCtx builds a ctx exactly as the webx middleware would: IP resolved
// server-side plus the self-reported platform triple.
func clientCtx(t *testing.T) context.Context {
	t.Helper()
	var got context.Context
	h := webx.ClientMetadata()(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = r.Context()
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.20:4444"
	req.Header.Set(webx.HeaderClientPlatform, "web")
	req.Header.Set(webx.HeaderClientVersion, "1.0.0")
	req.Header.Set(webx.HeaderClientOS, "macos")
	h.ServeHTTP(httptest.NewRecorder(), req)
	require.NotNil(t, got)
	return got
}

func wiredForTest(t *testing.T, repo *fakeRepo, store *fakeStore, extra func(*Config)) *Module {
	t.Helper()
	resetDocs(t, validDoc("tos", BillingV1Subscription), validDoc("privacy", BillingV1Subscription))
	cfg := Config{Pool: lazyPool(t), Store: store, Log: nil}
	if extra != nil {
		extra(&cfg)
	}
	m, err := Wire(cfg)
	if err != nil {
		t.Helper()
		t.Fatalf("wire: %v", err)
	}
	m.repo = repo // hermetic repo swap after the wiring checks ran
	if cfg.Auditor != nil {
		m.service.auditor = cfg.Auditor
	}
	m.service.repo = repo
	return m
}

// --- Wire --------------------------------------------------------------------

func TestWire_RequiredFields(t *testing.T) {
	resetDocs(t)
	err := func() error {
		_, err := Wire(Config{Store: &fakeStore{}})
		return err
	}()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Pool")

	_, err = Wire(Config{Pool: lazyPool(t)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Store")
}

func TestWire_RegistersKeySpecs(t *testing.T) {
	resetDocs(t)
	store := &fakeStore{}
	_, err := Wire(Config{Pool: lazyPool(t), Store: store})
	require.NoError(t, err)
	assert.Equal(t, 6, store.registered, "the whole legal_* key group lands on the store")
}

func TestWire_RegisterKeysErrorPropagates(t *testing.T) {
	resetDocs(t)
	_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{regErr: errors.New("boom")}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "register settings keys")
}

func TestWire_BillingModelReconciliation(t *testing.T) {
	t.Run("match passes", func(t *testing.T) {
		resetDocs(t, validDoc("tos", BillingV1Subscription))
		_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}})
		require.NoError(t, err)
	})
	t.Run("mismatch fails naming the doc", func(t *testing.T) {
		resetDocs(t, validDoc("tos", BillingV1Subscription))
		_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{eff: map[string]string{KeyBillingModel: BillingV2Credits}}})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "mismatch")
		assert.Contains(t, err.Error(), `"tos"`)
		assert.Contains(t, err.Error(), BillingV1Subscription)
		assert.Contains(t, err.Error(), BillingV2Credits)
	})
	t.Run("unset with docs fails on a store without spec-default fallback", func(t *testing.T) {
		// A custom SettingsStore that resolves nothing for the key keeps the
		// fail-closed boot error (the SettingsStore interface does not require
		// Default semantics — settings.Store has them, bare fakes may not).
		resetDocs(t, validDoc("tos", BillingV1Subscription))
		_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{}})
		require.Error(t, err)
		assert.Contains(t, err.Error(), KeyBillingModel)
		assert.Contains(t, err.Error(), "LEGAL_BILLING_MODEL")
	})
	// R3 (audit finding: example bare-start refusal): with the spec Default
	// (v1_subscription) registered on a settings.Store-shaped store, a fresh
	// database — no row, no env — boots clean. Out of the box the most common
	// model needs zero configuration.
	t.Run("fresh DB, no key, no env: Default v1_subscription reconciles clean", func(t *testing.T) {
		resetDocs(t, validDoc("tos", BillingV1Subscription), validDoc("privacy", BillingV1Subscription))
		_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{defaults: true}})
		require.NoError(t, err, "spec Default fills the unset key; v1 docs match it")
	})
	t.Run("v3 docs still require the explicit override (Default is v1)", func(t *testing.T) {
		resetDocs(t, validDoc("tos", BillingV3Hybrid))
		_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{defaults: true}})
		require.Error(t, err, "default v1_subscription vs a v3_hybrid doc is a mismatch, not a silent pass")
		assert.Contains(t, err.Error(), "mismatch")
		assert.Contains(t, err.Error(), KeyBillingModel)
	})
	t.Run("no docs registered: unset is fine", func(t *testing.T) {
		resetDocs(t)
		_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{}})
		require.NoError(t, err, "settings-only wiring (no RegisterDocs) has nothing to reconcile")
	})
	t.Run("single-key read failure fails the boot", func(t *testing.T) {
		resetDocs(t, validDoc("tos", BillingV1Subscription))
		_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{effKeyErr: errors.New("db down")}})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "billing-model reconciliation")
	})
	// Regression (shuijing live smoke, 2026-10-25): a stored sealed key with
	// no PLOYKIT_SEAL_KEY in the environment fails Effective WHOLESALE — the
	// reconciliation used to amplify that unrelated mailer credential into
	// refusing app startup. It must read the single key and boot fine.
	t.Run("wholesale Effective failure but single key readable boots", func(t *testing.T) {
		resetDocs(t, validDoc("tos", BillingV1Subscription))
		_, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{
			effErr: errors.New("settings: read sensitive key resend_api_key: no sealer"),
			eff:    map[string]string{KeyBillingModel: BillingV1Subscription},
		}})
		require.NoError(t, err)
	})
}

// --- Hooks -------------------------------------------------------------------

func TestHooks_AfterRegister(t *testing.T) {
	repo := newFakeRepo()
	m := wiredForTest(t, repo, &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)

	hooks := m.Hooks()
	require.NotNil(t, hooks.AfterRegister)
	require.NoError(t, hooks.AfterRegister(clientCtx(t), "u-1"))

	require.Len(t, repo.inserted, 1)
	rows := repo.inserted[0]
	require.Len(t, rows, 2, "one signup row per registered doc")
	for _, row := range rows {
		assert.Equal(t, "u-1", row.UserID)
		assert.Equal(t, MethodSignup, row.Method)
		assert.Equal(t, "203.0.113.20", row.IP, "IP comes from the webx ctx carrier")
		assert.Equal(t, "web", row.ClientPlatform)
		assert.Equal(t, "1.0.0", row.ClientVersion)
		assert.Equal(t, "macos", row.ClientOS)
	}
	assert.Equal(t, "tos", rows[0].DocKey)
	assert.Equal(t, "privacy", rows[1].DocKey)

	// Re-fire (the identity contract re-runs AfterRegister on the next
	// login after a failure): the repo's DO-NOTHING semantics absorb it.
	require.NoError(t, hooks.AfterRegister(context.Background(), "u-1"))
}

func TestHooks_AfterRegister_NoDocs(t *testing.T) {
	resetDocs(t)
	repo := newFakeRepo()
	m, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{}})
	require.NoError(t, err)
	m.repo = repo
	require.NoError(t, m.Hooks().AfterRegister(context.Background(), "u-1"))
	assert.Empty(t, repo.inserted, "no registered docs → no-op")
}

func TestHooks_AfterLogin(t *testing.T) {
	t.Run("backfills only unaccepted current versions", func(t *testing.T) {
		// tos 1.0 already recorded (any method counts); privacy missing.
		repo := newFakeRepo("tos\x001.0")
		m := wiredForTest(t, repo, &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)

		require.NoError(t, m.Hooks().AfterLogin(clientCtx(t), "u-2", "sess-1"))
		require.Len(t, repo.inserted, 1)
		rows := repo.inserted[0]
		require.Len(t, rows, 1, "one lookup, one batch write, only the gap")
		assert.Equal(t, "privacy", rows[0].DocKey)
		assert.Equal(t, MethodLoginImplicit, rows[0].Method)
		assert.Equal(t, "203.0.113.20", rows[0].IP)
	})
	t.Run("steady state: zero writes", func(t *testing.T) {
		repo := newFakeRepo("tos\x001.0", "privacy\x001.0")
		m := wiredForTest(t, repo, &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)
		require.NoError(t, m.Hooks().AfterLogin(context.Background(), "u-2", "sess-1"))
		assert.Empty(t, repo.inserted, "every current version recorded → no write on login")
	})
	t.Run("older version recorded: current still backfilled", func(t *testing.T) {
		repo := newFakeRepo("tos\x000.9")
		m := wiredForTest(t, repo, &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)
		require.NoError(t, m.Hooks().AfterLogin(context.Background(), "u-3", "sess-2"))
		require.Len(t, repo.inserted, 1)
		assert.Len(t, repo.inserted[0], 2, "the 0.9 row does not cover the 1.0 version")
	})
	t.Run("lookup error propagates for the caller's WARN log", func(t *testing.T) {
		repo := &fakeRepo{unacceptedErr: errors.New("db down")}
		m := wiredForTest(t, repo, &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)
		err := m.Hooks().AfterLogin(context.Background(), "u-4", "sess-3")
		require.Error(t, err)
	})
}

// --- Service -----------------------------------------------------------------

func TestService_Reaccept(t *testing.T) {
	t.Run("unknown doc key", func(t *testing.T) {
		repo := newFakeRepo()
		m := wiredForTest(t, repo, &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)
		err := m.Service().Reaccept(context.Background(), &webx.Principal{UserID: "u-9"}, "cookie-policy")
		require.Error(t, err)
		var e *webx.Error
		assert.ErrorAs(t, err, &e, "validation error shape")
		assert.Empty(t, repo.inserted)
	})
	t.Run("nil principal", func(t *testing.T) {
		m := wiredForTest(t, newFakeRepo(), &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)
		err := m.Service().Reaccept(context.Background(), nil, "tos")
		require.Error(t, err)
	})
	t.Run("happy path writes row + audit", func(t *testing.T) {
		repo := newFakeRepo()
		aud := &fakeAuditor{}
		m := wiredForTest(t, repo, &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, func(c *Config) {
			c.Auditor = aud
		})
		p := &webx.Principal{UserID: "u-9", Email: "u9@test.dev"}
		require.NoError(t, m.Service().Reaccept(clientCtx(t), p, "tos"))

		require.Len(t, repo.inserted, 1)
		row := repo.inserted[0][0]
		assert.Equal(t, MethodReaccept, row.Method)
		assert.Equal(t, "tos", row.DocKey)
		assert.Equal(t, "1.0", row.DocVersion)

		require.Len(t, aud.calls, 1)
		call := aud.calls[0]
		assert.Equal(t, actionReaccept, call["action"])
		assert.Equal(t, resourceTypeDoc, call["resource_type"])
		assert.Equal(t, "tos", call["resource_id"])
		meta := call["meta"].(map[string]any)
		assert.Equal(t, "1.0", meta["doc_version"])
		assert.Equal(t, "203.0.113.20", meta["ip"])
	})
	t.Run("reaccepting an already-recorded version is a silent no-op", func(t *testing.T) {
		repo := newFakeRepo("tos\x001.0")
		m := wiredForTest(t, repo, &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)
		require.NoError(t, m.Service().Reaccept(context.Background(), &webx.Principal{UserID: "u-9"}, "tos"))
	})
	t.Run("no auditor wired: no audit write, no panic", func(t *testing.T) {
		m := wiredForTest(t, newFakeRepo(), &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)
		require.NoError(t, m.Service().Reaccept(context.Background(), &webx.Principal{UserID: "u-9"}, "privacy"))
	})
}

func TestService_AcceptancesByUser(t *testing.T) {
	m := wiredForTest(t, newFakeRepo(), &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)

	_, err := m.Service().AcceptancesByUser(context.Background(), "not-a-uuid")
	require.Error(t, err, "identity user ids are UUIDs; garbage is rejected before the query")

	_, err = m.Service().AcceptancesByUser(context.Background(), "6f9619ff-8bd0-4c3d-9b8b-0a1b2c3d4e5f")
	require.NoError(t, err)
}

// --- PublicConfig --------------------------------------------------------------

func TestPublicConfig(t *testing.T) {
	store := &fakeStore{eff: map[string]string{
		KeyEntityName:   "Acme Pte. Ltd.",
		KeyJurisdiction: "the laws of Singapore",
		KeyContactEmail: "legal@acme.test",
		KeyBillingModel: BillingV1Subscription,
	}}
	m := wiredForTest(t, newFakeRepo(), store, func(c *Config) {
		c.ProcessorName = func() string { return "Waffo Pancake" }
		c.SiteURL = func() string { return "https://acme.test" }
	})

	out := m.PublicConfig(context.Background())
	assert.Equal(t, "Acme Pte. Ltd.", out.EntityName)
	assert.Equal(t, "the laws of Singapore", out.Jurisdiction)
	assert.Equal(t, "Waffo Pancake", out.ProcessorName, "live value from the callback, never a billing import")
	assert.Equal(t, "legal@acme.test", out.ContactEmail)
	require.Len(t, out.Docs, 2)
	assert.Equal(t, PublicDoc{Key: "tos", Version: "1.0", EffectiveFrom: "2026-10-25"}, out.Docs[0])
	assert.Equal(t, "https://acme.test", m.SiteURL())
}

func TestPublicConfig_UnfilledAndDegraded(t *testing.T) {
	t.Run("unfilled keys stay empty strings", func(t *testing.T) {
		m := wiredForTest(t, newFakeRepo(), &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}, nil)
		out := m.PublicConfig(context.Background())
		assert.Empty(t, out.EntityName)
		assert.Empty(t, out.Jurisdiction)
		assert.Empty(t, out.ProcessorName)
		assert.Empty(t, out.ContactEmail)
		assert.NotEmpty(t, out.Docs, "docs publish regardless: versions are code constants")
	})
	t.Run("settings read failure: docs still publish, values degrade", func(t *testing.T) {
		// Wire's boot reconciliation needs a successful read; the outage
		// starts AFTER wiring, hitting only the per-request PublicConfig.
		store := &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}
		m := wiredForTest(t, newFakeRepo(), store, func(c *Config) {
			c.ProcessorName = func() string { return "Waffo Pancake" }
		})
		store.effErr = errors.New("db down")
		out := m.PublicConfig(context.Background())
		assert.Empty(t, out.EntityName)
		assert.Equal(t, "Waffo Pancake", out.ProcessorName, "independent source survives the settings outage")
		assert.Len(t, out.Docs, 2)
	})
	t.Run("no docs registered: empty list, not nil", func(t *testing.T) {
		resetDocs(t)
		store := &fakeStore{eff: map[string]string{}}
		m, err := Wire(Config{Pool: lazyPool(t), Store: store})
		require.NoError(t, err)
		out := m.PublicConfig(context.Background())
		require.NotNil(t, out.Docs)
		assert.Empty(t, out.Docs)
	})
}

func TestPublicConfig_EffectiveFromUTCDate(t *testing.T) {
	resetDocs(t, Doc{
		Key:           "tos",
		Version:       "2.0",
		EffectiveFrom: time.Date(2027, 1, 2, 23, 30, 0, 0, time.FixedZone("X", 8*3600)),
		BillingModel:  BillingV3Hybrid,
	})
	store := &fakeStore{eff: map[string]string{KeyBillingModel: BillingV3Hybrid}}
	m, err := Wire(Config{Pool: lazyPool(t), Store: store})
	require.NoError(t, err)
	out := m.PublicConfig(context.Background())
	require.Len(t, out.Docs, 1)
	assert.Equal(t, "2027-01-02", out.Docs[0].EffectiveFrom, "UTC date, not the local-zone timestamp")
}
