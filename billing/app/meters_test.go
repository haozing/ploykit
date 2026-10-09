package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func TestRegisterMeter_ValidationAndWiring(t *testing.T) {
	repo := newFakeRepo()
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil).WithMeterRegistry(repo)

	m := Meter{Slug: "api_calls", DisplayName: "API 调用", AggType: "sum"}

	unwired := NewBillingService(newFakeRepo(), NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)
	err := unwired.RegisterMeter(context.Background(), m)
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 503, we.Status)

	for _, bad := range []Meter{
		{Slug: "x", DisplayName: "x", AggType: "avg"},
		{Slug: "", DisplayName: "x", AggType: "sum"},
		{Slug: "x", DisplayName: "", AggType: "sum"},
	} {
		err := svc.RegisterMeter(context.Background(), bad)
		require.ErrorAs(t, err, &we, "agg=%s slug=%q", bad.AggType, bad.Slug)
		assert.Equal(t, 400, we.Status)
	}

	require.NoError(t, svc.RegisterMeter(context.Background(), m))
	got, ok, err := svc.GetMeter(context.Background(), "api_calls")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "sum", got.AggType)
	assert.Equal(t, "API 调用", got.DisplayName)
}

func TestRegisterMeter_IdempotentAndImmutable(t *testing.T) {
	repo := newFakeRepo()
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil).WithMeterRegistry(repo)
	ctx := context.Background()

	require.NoError(t, svc.RegisterMeter(ctx, Meter{Slug: "api_calls", DisplayName: "API", AggType: "sum", Unit: "次"}))

	require.NoError(t, svc.RegisterMeter(ctx, Meter{Slug: "api_calls", DisplayName: "API 调用次数", AggType: "sum", Unit: "calls"}))
	got, ok, err := svc.GetMeter(ctx, "api_calls")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "API 调用次数", got.DisplayName, "描述性元数据可在幂等重注册时刷新")

	err = svc.RegisterMeter(ctx, Meter{Slug: "api_calls", DisplayName: "API", AggType: "unique_count"})
	require.ErrorIs(t, err, ErrMeterImmutable)

	meters, err := svc.ListMeters(ctx)
	require.NoError(t, err)
	require.Len(t, meters, 1, "幂等注册不产生重复行")
}

func TestMeterDueOverages_UsesRegistryMetadata(t *testing.T) {
	repo := newFakeRepo()
	exp := testNow.AddDate(0, 1, 0)
	repo.metered = []MeteredWorkspace{{
		WorkspaceID:   "ws_1",
		PlanCode:      "meter_e2e",
		Limits:        map[string]int{"metered_api_calls_unit_cents": 2, "metered_api_calls_included": 1000, "metered_tokens_unit_cents": 5, "metered_tokens_included": 100},
		PlanExpiresAt: &exp,
	}}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil).WithMeterRegistry(repo)
	require.NoError(t, svc.RegisterMeter(context.Background(), Meter{
		Slug: "api_calls", DisplayName: "API 调用", AggType: "count", Unit: "次",
	}))
	usage := func(_ context.Context, _, key, _ string) (int64, int64, error) {
		if key == "api_calls" {
			return 1200, 0, nil
		}
		return 150, 0, nil
	}

	orders, err := svc.MeterDueOverages(context.Background(), testNow, usage, 10)
	require.NoError(t, err)
	require.Len(t, orders, 1)
	items := orders[0].Metadata["items"].([]overageMetaItem)
	require.Len(t, items, 2, "两维都出账（计价始终以 plan.limits 为准）")

	byDim := map[string]overageMetaItem{}
	for _, it := range items {
		byDim[it.Dim] = it
	}

	assert.Equal(t, "API 调用", byDim["api_calls"].DisplayName)
	assert.Equal(t, "count", byDim["api_calls"].AggType)
	assert.Equal(t, "次", byDim["api_calls"].Unit)

	assert.Empty(t, byDim["tokens"].DisplayName)
	assert.Empty(t, byDim["tokens"].AggType)
	assert.EqualValues(t, 50, byDim["tokens"].OverageUnits)
}

func TestMeterDueOverages_ZeroRegistryCompat(t *testing.T) {
	repo := newFakeRepo()
	exp := testNow.AddDate(0, 1, 0)
	repo.metered = []MeteredWorkspace{{
		WorkspaceID:   "ws_1",
		PlanCode:      "meter_e2e",
		Limits:        map[string]int{"metered_api_calls_unit_cents": 2, "metered_api_calls_included": 1000},
		PlanExpiresAt: &exp,
	}}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil)

	orders, err := svc.MeterDueOverages(context.Background(), testNow,
		func(_ context.Context, _, _, _ string) (int64, int64, error) { return 1100, 0, nil }, 10)
	require.NoError(t, err)
	require.Len(t, orders, 1)
	items := orders[0].Metadata["items"].([]overageMetaItem)
	require.Len(t, items, 1)
	assert.Empty(t, items[0].DisplayName, "零注册表现状：不带元数据照常出账")
}

func TestMeterDueOverages_RegistryErrorDegrades(t *testing.T) {
	repo := newFakeRepo()
	exp := testNow.AddDate(0, 1, 0)
	repo.metered = []MeteredWorkspace{{
		WorkspaceID:   "ws_1",
		PlanCode:      "meter_e2e",
		Limits:        map[string]int{"metered_api_calls_unit_cents": 2, "metered_api_calls_included": 1000},
		PlanExpiresAt: &exp,
	}}
	svc := NewBillingService(repo, NewChannelRegistry(), Config{}, BillingHooks{}, nil,
		func() time.Time { return testNow }, nil).
		WithMeterRegistry(errMeterRegistry{err: errors.New("registry down")})

	orders, err := svc.MeterDueOverages(context.Background(), testNow,
		func(_ context.Context, _, _, _ string) (int64, int64, error) { return 1100, 0, nil }, 10)
	require.NoError(t, err, "注册表故障只降级元数据，不得阻断出账")
	require.Len(t, orders, 1)
}

type errMeterRegistry struct{ err error }

func (e errMeterRegistry) RegisterMeter(context.Context, Meter) error  { return e.err }
func (e errMeterRegistry) ListMeters(context.Context) ([]Meter, error) { return nil, e.err }
func (e errMeterRegistry) GetMeter(context.Context, string) (Meter, bool, error) {
	return Meter{}, false, e.err
}

var _ MeterRegistry = (*fakeRepo)(nil)
