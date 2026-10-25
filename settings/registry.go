package settings

import (
	"fmt"
	"regexp"
	"strings"
)

// Product-registered custom keys (shuijing field report, 2026-10-25). The
// built-in key set is a closed whitelist by design — the generic admin
// settings API must not accept arbitrary keys — but products kept needing
// "admin-configurable, sealed-at-rest" keys of their own (resend_api_key,
// product-specific integrations …) and hand-rolled ~200-line shadow endpoints
// each time. RegisterKeys is the framework seam: a registered key behaves
// exactly like a built-in one on every surface — the generic PUT validates,
// seals (Sensitive), masks on read-back, and lists it with its Description —
// while products keep zero endpoints of their own.

// KeySpec describes one product-registered settings key.
type KeySpec struct {
	// Key is the settings key, e.g. "resend_api_key". Lowercase letters,
	// digits and underscores, starting with a letter, at most 64 chars; must
	// not collide with a built-in key or the billing_channel.* namespace.
	Key string

	// Description is shown in the admin settings UI next to the field.
	Description string

	// Sensitive marks a credential: sealed at rest (sealx, fail-closed),
	// masked on every read-back surface, excluded from public /config
	// (consumers filter with Store.IsSensitive), never logged.
	Sensitive bool

	// Env optionally names an environment variable that backs the key while
	// no DB row exists (DB row > env > Default). Live on every boot until an
	// admin saves a value — the "never bootstrap-seeded" generation of the
	// D2 fork in keys.go; an env credential is never frozen into the table.
	Env string

	// Default is the effective value when neither a DB row nor a non-empty
	// env value exists.
	Default string

	// Validate rejects invalid values on the admin PUT path. nil = the
	// generic 8192-char cap (same as billing_channel fields).
	Validate func(value string) error

	// Normalize canonicalizes a value before storing. nil = TrimSpace (the
	// built-in default).
	Normalize func(value string) string
}

var (
	specKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	specEnvRe = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)
)

// RegisterKeys adds product keys to this store's registry. Call it at boot,
// before the admin settings routes serve traffic (reads take the registry
// lock, but registration between concurrent requests is not a supported
// lifecycle). An error names the offending spec: bad key shape, built-in or
// billing_channel collision, bad Env shape, or duplicate registration.
func (s *Store) RegisterKeys(specs ...KeySpec) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.specByKey == nil {
		s.specByKey = map[string]KeySpec{}
	}
	// Two passes so a bad spec rejects the whole batch atomically — no
	// partial registration for the caller to untangle at boot. batchSeen
	// catches duplicates within the batch that the map lookup cannot (the
	// batch has not been committed yet).
	batchSeen := map[string]bool{}
	for _, spec := range specs {
		if !specKeyRe.MatchString(spec.Key) {
			return fmt.Errorf("settings: register key %q: must match ^[a-z][a-z0-9_]{0,63}$", spec.Key)
		}
		if strings.HasPrefix(spec.Key, BillingChannelKeyPrefix) {
			return fmt.Errorf("settings: register key %q: the %s namespace is reserved", spec.Key, BillingChannelKeyPrefix)
		}
		if _, dup := s.specByKey[spec.Key]; dup || batchSeen[spec.Key] {
			return fmt.Errorf("settings: register key %q: already registered", spec.Key)
		}
		if builtinKeySet[spec.Key] {
			return fmt.Errorf("settings: register key %q: collides with a built-in key", spec.Key)
		}
		if spec.Env != "" && !specEnvRe.MatchString(spec.Env) {
			return fmt.Errorf("settings: register key %q: env %q must match ^[A-Z][A-Z0-9_]{0,63}$", spec.Key, spec.Env)
		}
		batchSeen[spec.Key] = true
	}
	for _, spec := range specs {
		s.specByKey[spec.Key] = spec
		s.specOrder = append(s.specOrder, spec.Key)
	}
	return nil
}

// specOf returns the registered spec for key, or the zero spec with ok=false.
// Callers must not mutate the returned func fields concurrently — specs are
// boot-time constants.
func (s *Store) specOf(key string) (spec KeySpec, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.specByKey == nil {
		return KeySpec{}, false
	}
	spec, ok = s.specByKey[key]
	return spec, ok
}

// registeredKeys lists registered keys in registration order.
func (s *Store) registeredKeys() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.specOrder...)
}

// IsSensitive extends the built-in rule with this store's registered keys.
// Package-level IsSensitive covers the built-ins only; consumers with a Store
// (the admin HTTP adapter, the public /config builder) must use this method
// so registered credentials seal and mask identically.
func (s *Store) IsSensitive(key string) bool {
	if IsSensitive(key) {
		return true
	}
	spec, ok := s.specOf(key)
	return ok && spec.Sensitive
}

// Validate extends the built-in whitelist with registered keys: a registered
// key runs its spec.Validate (nil = 8192-char cap). Package-level Validate
// stays closed-whitelist for callers without a Store.
func (s *Store) Validate(key, value string) error {
	if spec, ok := s.specOf(key); ok {
		if spec.Validate == nil {
			if len(value) > 8192 {
				return fmt.Errorf("%s 值过长（上限 8192 字符，当前 %d）", key, len(value))
			}
			return nil
		}
		return spec.Validate(value)
	}
	return Validate(key, value)
}

// Normalize extends the built-in normalization with registered keys (nil
// spec.Normalize = TrimSpace, same as the built-in default).
func (s *Store) Normalize(key, value string) string {
	if spec, ok := s.specOf(key); ok {
		if spec.Normalize == nil {
			return strings.TrimSpace(value)
		}
		return spec.Normalize(value)
	}
	return Normalize(key, value)
}

// Descriptions merges the built-in copy with registered keys' Descriptions
// (the admin settings list response renders from this map).
func (s *Store) Descriptions() map[string]string {
	out := make(map[string]string, len(Descriptions)+len(s.specOrder))
	for k, v := range Descriptions {
		out[k] = v
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for k, spec := range s.specByKey {
		out[k] = spec.Description
	}
	return out
}

// DefaultsMap merges the built-in defaults with registered keys' Defaults.
// (Named DefaultsMap because the package-level Defaults is already a map.)
func (s *Store) DefaultsMap() map[string]string {
	out := make(map[string]string, len(Defaults)+len(s.specOrder))
	for k, v := range Defaults {
		out[k] = v
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for k, spec := range s.specByKey {
		out[k] = spec.Default
	}
	return out
}

// effectiveSpecValue resolves a registered key with no DB row: live env
// fallback (never stored, never seeded — see the D2 fork in keys.go), then
// the spec Default.
func (s *Store) effectiveSpecValue(spec KeySpec) string {
	if spec.Env != "" && s.env != nil {
		if raw := strings.TrimSpace(s.env(spec.Env)); raw != "" {
			return raw
		}
	}
	return spec.Default
}
