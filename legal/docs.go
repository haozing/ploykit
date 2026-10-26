// Package legal is the framework's legal-compliance core (the
// legal-compliance framework plan, LC-1/LC-2/LC-3 + the LC-6 /config block):
// a compile-time document metadata registry, the legal_* settings key group,
// and click-through acceptance evidence that rides the existing identity
// hooks. It is a top-level composition package — NOT inside identity — for
// the same lateral-import reason as provisioning (ADR 0016): acceptance
// evidence composes identity hooks with the settings store and the audit
// recorder, and no single business domain may own that composition.
//
// Design anchors (plan §5 / audit L3-L6):
//
//   - Document text is DATA that ships with product code; the framework
//     stores only metadata (version, effective date, billing model,
//     placeholder list) — there is deliberately no legal_documents table
//     (audit L4: a DB copy of the version would be a second truth).
//   - Legal identity (entity name, jurisdiction, contact) lives in the
//     settings registry: Wire registers the whole legal_* key group, so the
//     generic admin settings card and env fallback come for free (audit L5).
//   - Acceptance evidence rides AfterRegister/AfterLogin — the identity
//     hooks that already fire on every registration/login path — instead of
//     new endpoints or an identity signature change (audit L3).
//   - Live values beat snapshots: the payment-processor name is a callback
//     (ProcessorName func() string), never a billing import — this package
//     must not depend on billing, so switching payment channels never leaves
//     stale copy in legal text.
package legal

import (
	"fmt"
	"regexp"
	"sync"
	"time"
)

// Billing-model enum — the Waffo template's mandatory three-way choice
// (subscription / credits / hybrid). Every registered Doc declares one, and
// Wire fails fast when the legal_billing_model setting disagrees with any
// Doc: the template's billing section and the live site must never diverge.
const (
	BillingV1Subscription = "v1_subscription"
	BillingV2Credits      = "v2_credits"
	BillingV3Hybrid       = "v3_hybrid"
)

var billingModels = map[string]bool{
	BillingV1Subscription: true,
	BillingV2Credits:      true,
	BillingV3Hybrid:       true,
}

// Doc is one legal document's compile-time metadata (LC-2). The text itself
// lives in product i18n files; this struct is what the framework reconciles
// and publishes — document versions ship with product code, so a release
// bump IS the version bump.
type Doc struct {
	// Key identifies the document ("tos", "privacy"). Lowercase letters,
	// digits and underscores, starting with a letter, at most 64 chars;
	// unique across registrations.
	Key string

	// Version is the human version tag rendered into /config and stored on
	// every acceptance row ("1.0", "2026-10-25.2", …).
	Version string

	// EffectiveFrom is the date the version takes legal effect. Required —
	// an acceptance row without an effective date cannot answer "which
	// version did they agree to" disputes.
	EffectiveFrom time.Time

	// BillingModel is the billing chapter this version's text carries —
	// one of BillingV1Subscription / BillingV2Credits / BillingV3Hybrid.
	BillingModel string

	// MaterialChange marks a version that materially changes obligations
	// (audited re-acceptation / change-notice territory; informational for
	// LC-3's evidence writes, consumed by the P1/P2 change-notice tooling).
	MaterialChange bool

	// Placeholders names the template variables the text references; every
	// entry must exist in the known placeholder set (the legal_* settings
	// keys plus payment_processor_name and site_url) so an unresolved
	// placeholder is caught at boot, not as "{{legal_entity_name}}" in
	// production copy.
	Placeholders []string
}

// registry is the process-wide document list. Boot-time written
// (RegisterDocs), read on every login hook and /config request; the mutex
// only exists so a concurrent first request cannot observe a torn append.
var registry = struct {
	sync.RWMutex
	docs []Doc
}{}

var docKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

// RegisterDocs adds document metadata to the process-wide registry. It runs
// at boot and fails fast — returning an error, not panicking — on: a bad
// key/version shape, a zero EffectiveFrom, a BillingModel outside the
// three-way enum, a placeholder outside the known set, or a duplicate key
// (within the batch or against already-registered docs). The batch is
// validated before anything is appended, so a rejected call leaves the
// registry untouched.
//
// Ordering with Wire: call RegisterDocs BEFORE legal.Wire — Wire reconciles
// every registered doc against the legal_billing_model setting and fails
// the boot on mismatch, which is only possible when the docs are already
// registered.
func RegisterDocs(docs ...Doc) error {
	if len(docs) == 0 {
		return nil
	}
	registry.Lock()
	defer registry.Unlock()

	seen := map[string]bool{}
	for _, d := range registry.docs {
		seen[d.Key] = true
	}
	// Validate the whole batch first (atomic registration, no partial
	// append for the caller to untangle mid-boot).
	batchSeen := map[string]bool{}
	for _, d := range docs {
		if !docKeyRe.MatchString(d.Key) {
			return fmt.Errorf("legal: register doc %q: key must match ^[a-z][a-z0-9_]{0,63}$", d.Key)
		}
		if d.Version == "" || len(d.Version) > 32 {
			return fmt.Errorf("legal: register doc %q: version must be 1..32 chars", d.Key)
		}
		if d.EffectiveFrom.IsZero() {
			return fmt.Errorf("legal: register doc %q: EffectiveFrom is required", d.Key)
		}
		if !billingModels[d.BillingModel] {
			return fmt.Errorf("legal: register doc %q: BillingModel must be one of %s, %s, %s",
				d.Key, BillingV1Subscription, BillingV2Credits, BillingV3Hybrid)
		}
		for _, p := range d.Placeholders {
			if !knownPlaceholders[p] {
				return fmt.Errorf("legal: register doc %q: unknown placeholder %q (known: the legal_* settings keys, payment_processor_name, site_url)", d.Key, p)
			}
		}
		if seen[d.Key] || batchSeen[d.Key] {
			return fmt.Errorf("legal: register doc %q: already registered", d.Key)
		}
		batchSeen[d.Key] = true
	}
	registry.docs = append(registry.docs, docs...)
	return nil
}

// RegisteredDocs returns a copy of the registry in registration order.
// Callers may mutate the returned slice freely.
func RegisteredDocs() []Doc {
	registry.RLock()
	defer registry.RUnlock()
	return append([]Doc(nil), registry.docs...)
}

// docByKey looks up one registered doc; ok=false when absent.
func docByKey(key string) (Doc, bool) {
	registry.RLock()
	defer registry.RUnlock()
	for _, d := range registry.docs {
		if d.Key == key {
			return d, true
		}
	}
	return Doc{}, false
}
