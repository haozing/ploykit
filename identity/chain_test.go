package identity

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeTx struct{ pgx.Tx }

// Chain composition order is observable via an append log each hook closes
// over; short-circuit and run-all behavior differ per field.
type orderLog struct{ events []string }

func (l *orderLog) record(name string) func(context.Context, string) error {
	return func(context.Context, string) error {
		l.events = append(l.events, name)
		return nil
	}
}

func TestChainHooks_OnRegisterTx_OrderAndShortCircuit(t *testing.T) {
	var events []string
	h := ChainHooks(
		IdentityHooks{OnRegisterTx: func(_ context.Context, _ pgx.Tx, _ string) error {
			events = append(events, "a")
			return nil
		}},
		IdentityHooks{OnRegisterTx: func(_ context.Context, _ pgx.Tx, _ string) error {
			events = append(events, "b")
			return errors.New("role binding failed")
		}},
		IdentityHooks{OnRegisterTx: func(_ context.Context, _ pgx.Tx, _ string) error {
			events = append(events, "c") // must NOT run: the tx is doomed
			return nil
		}},
	)
	require.NotNil(t, h.OnRegisterTx)
	err := h.OnRegisterTx(context.Background(), fakeTx{}, "u1")
	require.Error(t, err)
	assert.Equal(t, []string{"a", "b"}, events, "transactional hooks short-circuit on the first error")
}

func TestChainHooks_AfterRegister_RunsAllAndJoins(t *testing.T) {
	log := &orderLog{}
	failing := IdentityHooks{AfterRegister: func(context.Context, string) error {
		return errors.New("legal acceptance insert failed")
	}}
	chained := ChainHooks(
		IdentityHooks{AfterRegister: log.record("provisioning")},
		failing,
		IdentityHooks{AfterRegister: log.record("notify")},
	)
	require.NotNil(t, chained.AfterRegister)

	err := chained.AfterRegister(context.Background(), "u1")
	require.Error(t, err, "the joined error keeps the caller's ProvisioningPending + next-login re-fire contract")
	assert.Contains(t, err.Error(), "hook[1]", "attribution names the failing hook index")
	assert.Equal(t, []string{"provisioning", "notify"}, log.events,
		"one observational failure must not starve the remaining hooks")

	// Happy path stays nil so the identity ERROR log + ProvisioningPending
	// paths are untouched.
	assert.NoError(t, ChainHooks(
		IdentityHooks{AfterRegister: log.record("x")},
	).AfterRegister(context.Background(), "u2"))
}

func TestChainHooks_AfterLogin_RunsAllAndJoins(t *testing.T) {
	var calls []string
	chained := ChainHooks(
		IdentityHooks{AfterLogin: func(_ context.Context, _, sessionID string) error {
			calls = append(calls, "provisioning:"+sessionID)
			return nil
		}},
		IdentityHooks{AfterLogin: func(context.Context, string, string) error {
			return errors.New("sink down")
		}},
		IdentityHooks{AfterLogin: func(_ context.Context, userID, _ string) error {
			calls = append(calls, "legal:"+userID)
			return nil
		}},
	)
	require.NotNil(t, chained.AfterLogin)
	err := chained.AfterLogin(context.Background(), "u9", "s1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AfterLogin")
	assert.Contains(t, err.Error(), "hook[1]")
	assert.Len(t, calls, 2, "all hooks ran despite the middle failure")
	assert.Equal(t, "provisioning:s1", calls[0])
	assert.Equal(t, "legal:u9", calls[1])
}

func TestChainHooks_OnLoginFailed_RunsAllAndJoins(t *testing.T) {
	var seen []string
	chained := ChainHooks(
		IdentityHooks{OnLoginFailed: func(_ context.Context, email, ipHash string) error {
			seen = append(seen, email+"|"+ipHash)
			return nil
		}},
		IdentityHooks{OnLoginFailed: func(context.Context, string, string) error {
			return errors.New("risk sink timeout")
		}},
	)
	require.NotNil(t, chained.OnLoginFailed)
	err := chained.OnLoginFailed(context.Background(), "a@b.c", "hash1")
	require.Error(t, err)
	assert.Equal(t, []string{"a@b.c|hash1"}, seen)
	assert.True(t, strings.Contains(err.Error(), "risk sink timeout"), "the failure propagates for the caller's WARN log")
}

func TestChainHooks_AfterPasswordChange_RunsAllAndJoins(t *testing.T) {
	var n int
	chained := ChainHooks(
		IdentityHooks{AfterPasswordChange: func(context.Context, string) error {
			n++
			return errors.New("boom")
		}},
		IdentityHooks{AfterPasswordChange: func(context.Context, string) error {
			n++
			return nil
		}},
	)
	require.NotNil(t, chained.AfterPasswordChange)
	require.Error(t, chained.AfterPasswordChange(context.Background(), "u1"))
	assert.Equal(t, 2, n, "the second hook still runs after the first fails")
}

func TestChainHooks_NilSafety(t *testing.T) {
	// All-nil arguments and zero args yield a fully-nil hook value: the
	// firing sites' `if hooks.Field != nil` fast paths keep skipping.
	assert.Equal(t, IdentityHooks{}, ChainHooks())
	assert.Equal(t, IdentityHooks{}, ChainHooks(IdentityHooks{}, IdentityHooks{}))

	// A zero-value hook mixed with real hooks contributes nothing but does
	// not break the chain (IdentityHooks is a struct value: there is no nil
	// argument to pass, the zero value IS the "no hooks" case).
	log := &orderLog{}
	chained := ChainHooks(IdentityHooks{}, IdentityHooks{AfterRegister: log.record("only")})
	require.NotNil(t, chained.AfterRegister)
	assert.Nil(t, chained.OnRegisterTx)
	assert.Nil(t, chained.AfterLogin)
	assert.Nil(t, chained.OnLoginFailed)
	assert.Nil(t, chained.AfterPasswordChange)
	require.NoError(t, chained.AfterRegister(context.Background(), "u1"))
	assert.Equal(t, []string{"only"}, log.events)
}

func TestChainHooks_NilFieldsSkippedPerField(t *testing.T) {
	// Disjoint fields merge: each chained field only collects non-nil
	// contributors of its own kind.
	var txRan, loginRan bool
	chained := ChainHooks(
		IdentityHooks{OnRegisterTx: func(context.Context, pgx.Tx, string) error { txRan = true; return nil }},
		IdentityHooks{AfterLogin: func(context.Context, string, string) error { loginRan = true; return nil }},
	)
	require.NoError(t, chained.OnRegisterTx(context.Background(), fakeTx{}, "u"))
	require.NoError(t, chained.AfterLogin(context.Background(), "u", "s"))
	assert.True(t, txRan)
	assert.True(t, loginRan)
	assert.Nil(t, chained.AfterRegister, "no contributor → field stays nil for the firing-site fast path")
}
