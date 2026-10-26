package legal

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// resetDocs swaps the process-wide registry for a test and restores an empty
// one afterwards. The registry is boot-time global state by design (docs are
// compile-time constants); tests must not leak registrations into each other.
func resetDocs(t *testing.T, docs ...Doc) {
	t.Helper()
	registry.Lock()
	registry.docs = append([]Doc(nil), docs...)
	registry.Unlock()
	t.Cleanup(func() {
		registry.Lock()
		registry.docs = nil
		registry.Unlock()
	})
}

func validDoc(key, model string) Doc {
	return Doc{
		Key:           key,
		Version:       "1.0",
		EffectiveFrom: time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC),
		BillingModel:  model,
		Placeholders:  []string{KeyEntityName, "payment_processor_name"},
	}
}

func TestRegisterDocs_HappyPath(t *testing.T) {
	resetDocs(t)
	require.NoError(t, RegisterDocs(validDoc("tos", BillingV1Subscription), validDoc("privacy", BillingV1Subscription)))

	docs := RegisteredDocs()
	require.Len(t, docs, 2)
	assert.Equal(t, "tos", docs[0].Key, "registration order is preserved")
	assert.Equal(t, "privacy", docs[1].Key)

	// The returned slice is a copy: caller mutation cannot corrupt the registry.
	docs[0].Version = "tampered"
	assert.Equal(t, "1.0", RegisteredDocs()[0].Version)
}

func TestRegisterDocs_Rejections(t *testing.T) {
	cases := []struct {
		name string
		doc  Doc
		want string
	}{
		{"bad key shape", validDoc("TOS", BillingV1Subscription), "key must match"},
		{"empty version", func() Doc { d := validDoc("tos", BillingV1Subscription); d.Version = ""; return d }(), "version"},
		{"zero effective date", func() Doc { d := validDoc("tos", BillingV1Subscription); d.EffectiveFrom = time.Time{}; return d }(), "EffectiveFrom"},
		{"bad billing model", validDoc("tos", "v9_freemium"), "BillingModel"},
		{"unknown placeholder", func() Doc {
			d := validDoc("tos", BillingV1Subscription)
			d.Placeholders = []string{"legal_entity_nope"}
			return d
		}(), "unknown placeholder"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resetDocs(t)
			err := RegisterDocs(tc.doc)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.want)
			assert.Empty(t, RegisteredDocs(), "a rejected batch must leave the registry untouched")
		})
	}
}

func TestRegisterDocs_DuplicateKeys(t *testing.T) {
	t.Run("within one batch", func(t *testing.T) {
		resetDocs(t)
		err := RegisterDocs(validDoc("tos", BillingV1Subscription), validDoc("tos", BillingV1Subscription))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "already registered")
		assert.Empty(t, RegisteredDocs())
	})
	t.Run("against the registry", func(t *testing.T) {
		resetDocs(t, validDoc("tos", BillingV1Subscription))
		err := RegisterDocs(validDoc("tos", BillingV1Subscription))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "already registered")
		assert.Len(t, RegisteredDocs(), 1)
	})
	t.Run("atomic batch: one bad spec rejects all", func(t *testing.T) {
		resetDocs(t)
		err := RegisterDocs(validDoc("tos", BillingV1Subscription), validDoc("privacy", "v2_none"))
		require.Error(t, err)
		assert.Empty(t, RegisteredDocs(), "no partial registration for the caller to untangle at boot")
	})
}

func TestRegisterDocs_EmptyCall(t *testing.T) {
	resetDocs(t, validDoc("tos", BillingV1Subscription))
	require.NoError(t, RegisterDocs())
	assert.Len(t, RegisteredDocs(), 1)
}

func TestDocByKey(t *testing.T) {
	resetDocs(t, validDoc("privacy", BillingV2Credits))
	d, ok := docByKey("privacy")
	require.True(t, ok)
	assert.Equal(t, BillingV2Credits, d.BillingModel)
	_, ok = docByKey("tos")
	assert.False(t, ok)
}
