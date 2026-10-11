// Package authorization is example's strong-profile composition root
// (ADR 0005 restart / ADR 0013 batch 1): it glues the framework's
// authorization evaluator onto example's HTTP surface — product catalog
// (catalog.yaml), route resolver, in-transaction facts provider, and the
// strong middleware that projects decisions onto webx error envelopes.
//
// This lives in the composition root on purpose (arch A6): the framework's
// authorization package imports nothing and never sees HTTP shapes; the
// resolver is promoted to a framework package only when a second consumer
// (runlynk) confirms the shape.
package authorization

import (
	"embed"
	"fmt"
	"log/slog"
	"time"

	"github.com/haozing/ploykit/authorization"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/webx"
)

//go:embed catalog.yaml
var catalogFS embed.FS

// Strong is the wired strong-profile gate: catalog evaluator + resolver +
// facts provider, assembled once at boot and mounted per destructive route.
type Strong struct {
	eval     *authorization.Evaluator
	resolver *Resolver
	provider sessionFactsProvider
	db       *pg.DB
	cfg      webx.AuthConfig
	log      *slog.Logger
	now      func() time.Time
}

// New parses catalog.yaml, validates it against the (empty product) registry,
// and binds the resolver routes 1:1 to catalog operations — a route without an
// operation, or an operation without a route, fails startup (wiring
// discipline: catalog drift must never surface as runtime denials).
// New wires the strong-profile gate. cfg is the same AuthConfig the
// authentication middleware runs with — the transport classifier must see
// the request exactly as Authenticate does (ADR 0013 batch 3).
func New(db *pg.DB, cfg webx.AuthConfig, log *slog.Logger) (*Strong, error) {
	raw, err := catalogFS.ReadFile("catalog.yaml")
	if err != nil {
		return nil, fmt.Errorf("strongauth: read catalog: %w", err)
	}
	catalog, err := authorization.ParseCatalog(raw, authorization.NewRegistry())
	if err != nil {
		return nil, fmt.Errorf("strongauth: %w", err)
	}
	resolver := NewResolver()
	if err := resolver.Bind(catalog); err != nil {
		return nil, fmt.Errorf("strongauth: %w", err)
	}
	provider := NewTxFactsProvider(db)
	eval, err := authorization.NewEvaluator(catalog, authorization.NewRegistry(), provider)
	if err != nil {
		return nil, fmt.Errorf("strongauth: %w", err)
	}
	log.Info("strong-profile authorization wired",
		"operations", len(catalog.Operations), "catalog_hash", mustHash(catalog))
	return &Strong{eval: eval, resolver: resolver, provider: provider, db: db, cfg: cfg, log: log, now: time.Now}, nil
}

func mustHash(c authorization.Catalog) string {
	h, err := c.Hash()
	if err != nil {
		return "unhashable:" + err.Error()
	}
	return h
}
