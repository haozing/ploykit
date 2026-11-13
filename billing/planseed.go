package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/haozing/ploykit/billing/money"
	"github.com/haozing/ploykit/platform/pg"
)

// PlanSeed is a product's declarative override (or addition) to the framework
// plan catalog. The framework migration 007_plan_seed seeds `free`/`pro` with
// Chinese names and the plan.currency column default is CNY, so every
// non-Chinese product would otherwise have to hand-write UPDATE statements to
// fix its own price table. SeedPlans is that statement, typed and idempotent.
//
// Semantics (all fields except Code are optional):
//   - Name: "" leaves the stored name untouched.
//   - Currency: "" leaves the stored currency untouched; a non-empty value is
//     trimmed, upper-cased and validated (ISO-4217 shape + framework
//     minor-unit support). New plan codes MUST declare one — otherwise the
//     row would silently inherit the column default (CNY), the exact bug this
//     API exists to remove.
//   - Limits: nil/empty leaves the stored limits untouched. Non-empty MERGES
//     into the stored JSONB (right-hand keys win), so seeding only
//     {"price_monthly_cents": 9900} keeps tasks_monthly/workspaces and any
//     admin-added keys. Key shape is policed with the same regex as the admin
//     plan editor, so a typo fails at boot instead of poisoning the column.
//   - SortNo: 0 leaves the stored sort untouched (0 is therefore not
//     expressible as an explicit value; the seed baseline uses 1/2).
//
// Field semantics are per-field, not whole-row: a product that only declares
// {Code: "free", Name: "Free"} gets an English name while the 007 limits and
// the admin-edited currency stay as they are.
type PlanSeed struct {
	Code     string
	Name     string
	Currency string
	Limits   map[string]int
	SortNo   int
}

var (
	// mirrors migrations/040_plan_currency.up.sql's CHECK constraint
	planSeedCurrencyRe = regexp.MustCompile(`^[A-Z]{3}$`)
	// mirrors the admin plan editor's key guard (billing/app/service_adminops.go)
	planSeedLimitKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
)

// updatePlanSeedSQL applies a seed to an existing row, touching only the
// fields the seed actually declared. jsonb || '{}' is the no-op merge used
// when Limits is unset; NULLIF(x, ”) / NULLIF(n, 0) make "unset" fall back
// to the stored value.
const updatePlanSeedSQL = `
	UPDATE plan SET
		name     = COALESCE(NULLIF($2::text, ''), name),
		limits   = limits || COALESCE($3::jsonb, '{}'::jsonb),
		sort_no  = COALESCE(NULLIF($4::int, 0), sort_no),
		currency = COALESCE(NULLIF($5::text, ''), currency)
	WHERE code = $1`

// SeedPlans upserts seeds into the plan catalog, idempotently: calling it on
// every boot converges to the same state, and fields a seed does not declare
// keep whatever the database (007 baseline, a previous seed, or a platform
// admin edit) already holds. Each seed is applied independently; a failure
// names the plan code and stops the batch — the next boot re-applies the
// earlier seeds for free (they are idempotent), so no transaction spans the
// batch.
//
// Call it once at boot, after migrations have run. log may be nil
// (slog.Default is used). An empty seeds slice is a no-op that never touches
// the pool.
func SeedPlans(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger, seeds []PlanSeed) error {
	if log == nil {
		log = slog.Default()
	}
	if len(seeds) == 0 {
		return nil
	}
	// Seeds are validated BEFORE the first query (and before the pool check):
	// a bad seed must fail at boot with its index, never reach the
	// JSONB/currency columns.
	normalized := make([]PlanSeed, len(seeds))
	for i, s := range seeds {
		n, err := normalizePlanSeed(s)
		if err != nil {
			return fmt.Errorf("billing: SeedPlans: seed[%d]: %w", i, err)
		}
		normalized[i] = n
	}
	if pool == nil {
		return fmt.Errorf("billing: SeedPlans: nil pool")
	}

	for _, s := range normalized {
		if err := applyPlanSeed(ctx, pool, s); err != nil {
			return fmt.Errorf("billing: SeedPlans: plan %q: %w", s.Code, err)
		}
	}
	log.Info("plan seeds applied", "count", len(normalized))
	return nil
}

// normalizePlanSeed trims and validates one seed, returning the value the SQL
// layer should use (upper-cased currency, trimmed name/code). Every check is
// fail-fast at boot: a bad seed must not reach the JSONB/currency columns.
func normalizePlanSeed(s PlanSeed) (PlanSeed, error) {
	s.Code = strings.TrimSpace(s.Code)
	if s.Code == "" {
		return PlanSeed{}, fmt.Errorf("code is required")
	}
	if len(s.Code) > 64 {
		return PlanSeed{}, fmt.Errorf("code %q is longer than 64 bytes", s.Code)
	}
	if strings.ContainsAny(s.Code, " \t\r\n") {
		return PlanSeed{}, fmt.Errorf("code %q must not contain whitespace", s.Code)
	}

	s.Name = strings.TrimSpace(s.Name)
	if utf8.RuneCountInString(s.Name) > 100 {
		return PlanSeed{}, fmt.Errorf("name is longer than 100 characters")
	}

	s.Currency = strings.ToUpper(strings.TrimSpace(s.Currency))
	if s.Currency != "" {
		if !planSeedCurrencyRe.MatchString(s.Currency) {
			return PlanSeed{}, fmt.Errorf("currency %q must be a 3-letter ISO 4217 code", s.Currency)
		}
		// 三位小数币种（KWD/BHD/JOD…）在框架的 minor-unit 换算下会静默错价
		// 10 倍——与后台套餐编辑器走同一道闸。
		if err := money.CheckMinorUnit(s.Currency); err != nil {
			return PlanSeed{}, fmt.Errorf("currency rejected: %w", err)
		}
	}

	if len(s.Limits) > 0 {
		limits := make(map[string]int, len(s.Limits))
		for k, v := range s.Limits {
			if !planSeedLimitKeyRe.MatchString(k) {
				return PlanSeed{}, fmt.Errorf("invalid limits key %q (want ^[a-z][a-z0-9_]{0,63}$)", k)
			}
			limits[k] = v
		}
		s.Limits = limits
	} else {
		s.Limits = nil
	}

	return s, nil
}

// applyPlanSeed converges one plan row. Update first (the common case: 007
// already created free/pro), insert only when the code is new. The update
// statement also serializes the lost-insert-race recovery: if a concurrent
// boot created the row between our UPDATE and INSERT, the unique violation is
// swallowed and the UPDATE is replayed, which is guaranteed to match.
func applyPlanSeed(ctx context.Context, pool *pgxpool.Pool, s PlanSeed) error {
	var limitsArg any
	if len(s.Limits) > 0 {
		raw, err := json.Marshal(s.Limits)
		if err != nil {
			return fmt.Errorf("encode limits: %w", err)
		}
		limitsArg = string(raw)
	}
	var currencyArg any
	if s.Currency != "" {
		currencyArg = s.Currency
	}

	ct, err := pool.Exec(ctx, updatePlanSeedSQL, s.Code, s.Name, limitsArg, s.SortNo, currencyArg)
	if err != nil {
		return fmt.Errorf("update: %w", err)
	}
	if ct.RowsAffected() > 0 {
		return nil
	}

	// Insert path: a brand-new plan code. Currency is mandatory here — letting
	// it fall through to the column default is how English products ended up
	// with CNY prices.
	if s.Currency == "" {
		return fmt.Errorf("plan does not exist and the seed declares no currency (a new plan must state one)")
	}
	name := s.Name
	if name == "" {
		name = s.Code
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO plan (code, name, limits, sort_no, currency)
		VALUES ($1, $2, COALESCE($3::jsonb, '{}'::jsonb), $4::int, $5)`,
		s.Code, name, limitsArg, s.SortNo, s.Currency)
	if err == nil {
		return nil
	}
	if pg.IsUniqueViolation(err, "") {
		// Concurrent boot won the insert; replay as an update and converge.
		ct, err2 := pool.Exec(ctx, updatePlanSeedSQL, s.Code, s.Name, limitsArg, s.SortNo, currencyArg)
		if err2 != nil {
			return fmt.Errorf("update after insert race: %w", err2)
		}
		if ct.RowsAffected() > 0 {
			return nil
		}
	}
	return fmt.Errorf("insert: %w", err)
}
