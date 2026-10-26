package legal

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/settings"
)

func TestKeySpecs_Shape(t *testing.T) {
	specs := KeySpecs()
	require.Len(t, specs, 6)

	want := map[string]string{
		KeyEntityName:    "LEGAL_ENTITY_NAME",
		KeyEntityAddress: "LEGAL_ENTITY_ADDRESS",
		KeyJurisdiction:  "LEGAL_JURISDICTION",
		KeyContactEmail:  "LEGAL_CONTACT_EMAIL",
		KeyBillingModel:  "LEGAL_BILLING_MODEL",
		KeyMinAge:        "LEGAL_MIN_AGE",
	}
	seen := map[string]bool{}
	for _, s := range specs {
		wantEnv, ok := want[s.Key]
		require.True(t, ok, "unexpected key %q", s.Key)
		seen[s.Key] = true
		assert.Equal(t, wantEnv, s.Env, "%s env fallback name", s.Key)
		assert.False(t, s.Sensitive, "%s must never seal/mask: it feeds the public /config legal block", s.Key)
		assert.NotEmpty(t, s.Description, "%s needs a description for the admin settings card", s.Key)
		assert.NotNil(t, s.Validate, "%s needs a Validate func", s.Key)
		// Individual + company examples: the description must explain both
		// shapes so a solo founder and a registered entity both know what
		// to type (plan LC-1).
		for _, key := range []string{KeyEntityName, KeyEntityAddress} {
			if s.Key == key {
				assert.Contains(t, s.Description, "个人", "%s describes the individual shape", key)
				assert.Contains(t, s.Description, "公司", "%s describes the company shape", key)
			}
		}
	}
	assert.Len(t, seen, 6, "no duplicate keys in the group")
}

func TestKeySpecs_RegisterOnSettingsStore(t *testing.T) {
	// settings.NewStore(nil) never touches the pool on the registry path —
	// the KeySpec round-trip is hermetic.
	store := settings.NewStore(nil)
	require.NoError(t, store.RegisterKeys(KeySpecs()...))

	// Duplicate registration fails (the second Wire call names the offender).
	err := store.RegisterKeys(KeySpecs()...)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already registered")

	// The keys behave like built-ins on every settings surface.
	for _, k := range []string{KeyEntityName, KeyBillingModel, KeyMinAge} {
		assert.False(t, store.IsSensitive(k))
		require.NoError(t, store.Validate(k, ""))
	}
	require.NoError(t, store.Validate(KeyEntityName, "Zhang San"))
	assert.Error(t, store.Validate(KeyBillingModel, "v0_free"), "outside the three-way enum")
}

// R3 (audit finding): the billing-model key carries Default=v1_subscription —
// a fresh database with no row and no env must resolve it, or a bare
// legal.Wire boot fails on "key unset" out of the box (the example
// bare-start regression this default exists to fix).
func TestKeySpecs_BillingModelDefault(t *testing.T) {
	specs := KeySpecs()
	var model settings.KeySpec
	for _, s := range specs {
		if s.Key == KeyBillingModel {
			model = s
		}
	}
	require.Equal(t, KeyBillingModel, model.Key, "spec present")
	assert.Equal(t, BillingV1Subscription, model.Default, "out-of-box default = the most common model")
	assert.NoError(t, model.Validate(model.Default), "default must satisfy its own validator")

	// And the real store resolves it on the no-row path: effectiveSpecValue
	// is env > Default, so with no env the spec default is the answer. This
	// mirrors settings.TestEffectiveSpecValue "env 缺省/空白 → spec Default".
	store := settings.NewStore(nil)
	require.NoError(t, store.RegisterKeys(KeySpecs()...))
	assert.Equal(t, BillingV1Subscription, store.DefaultsMap()[KeyBillingModel],
		"the registered default is visible on the settings defaults surface")
}

func TestValidateBillingModel(t *testing.T) {
	for _, ok := range []string{"", " ", "v1_subscription", "v2_credits", "v3_hybrid"} {
		assert.NoError(t, validateBillingModel(ok), "valid: %q", ok)
	}
	for _, bad := range []string{"v0_free", "subscription", "V1_SUBSCRIPTION"} {
		assert.Error(t, validateBillingModel(bad), "invalid: %q", bad)
	}
}

func TestValidateMinAge(t *testing.T) {
	for _, ok := range []string{"", "13", "16", "18"} {
		assert.NoError(t, validateMinAge(ok), "valid: %q", ok)
	}
	for _, bad := range []string{"0", "100", "abc", "13.5", "-1"} {
		assert.Error(t, validateMinAge(bad), "invalid: %q", bad)
	}
}

func TestValidateContactEmail(t *testing.T) {
	assert.NoError(t, validateContactEmail(""), "empty = unfilled state, not an error")
	assert.NoError(t, validateContactEmail("legal@example.com"))
	assert.Error(t, validateContactEmail("not-an-email"))
	assert.Error(t, validateContactEmail("a@b"), "missing TLD")
}

func TestValidateCappedLen(t *testing.T) {
	assert.NoError(t, cappedLen(strings.Repeat("名", 200), 200, KeyEntityName))
	assert.Error(t, cappedLen(strings.Repeat("名", 201), 200, KeyEntityName),
		"rune count, not bytes: 201 CJK chars over the 200 cap")
}
