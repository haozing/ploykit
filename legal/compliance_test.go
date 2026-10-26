package legal

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- LC-9 compliance report (admin card data source) ----

// checkIDs pins the promise-reconciliation checklist: seven rows, stable ids.
var wantCheckIDs = []string{
	"legal_docs",
	"payment_processor",
	"acceptance_hooks",
	"account_export",
	"retention_sweepers",
	"refund_policy_channel",
	"server_log_rotation",
}

func TestCompliance_MissingKeysRedLights(t *testing.T) {
	t.Run("全空 → 四个必填键全红，附后台卡说明", func(t *testing.T) {
		resetDocs(t) // no docs: Wire has nothing to reconcile, empty eff is fine
		m, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{}})
		require.NoError(t, err)

		rep := m.Compliance(context.Background())
		require.Len(t, rep.MissingKeys, 4)
		got := map[string]string{}
		for _, k := range rep.MissingKeys {
			got[k.Key] = k.Description
			assert.NotEmpty(t, k.Description, "红灯行必须带 KeySpec 的说明文案")
		}
		for _, key := range []string{KeyEntityName, KeyJurisdiction, KeyContactEmail, KeyBillingModel} {
			assert.Contains(t, got, key)
		}
		// entity_address / legal_min_age are intentionally NOT red lights.
		assert.NotContains(t, got, KeyEntityAddress)
		assert.NotContains(t, got, KeyMinAge)
	})

	t.Run("填了三留一 → 只红缺的那个", func(t *testing.T) {
		resetDocs(t)
		store := &fakeStore{eff: map[string]string{
			KeyEntityName:   "Acme Pte. Ltd.",
			KeyJurisdiction: "the laws of Singapore",
			KeyBillingModel: BillingV1Subscription,
		}}
		m, err := Wire(Config{Pool: lazyPool(t), Store: store})
		require.NoError(t, err)

		rep := m.Compliance(context.Background())
		require.Len(t, rep.MissingKeys, 1)
		assert.Equal(t, KeyContactEmail, rep.MissingKeys[0].Key)

		// legal_config mirrors the resolved values (the red-list context row).
		assert.Equal(t, "Acme Pte. Ltd.", rep.LegalConfig.EntityName)
		assert.Equal(t, "the laws of Singapore", rep.LegalConfig.Jurisdiction)
		assert.Equal(t, BillingV1Subscription, rep.LegalConfig.BillingModel)
		assert.Empty(t, rep.LegalConfig.ProcessorName, "ProcessorName 未接 → 空（对账行 warn）")
	})
}

func TestCompliance_ChecklistShape(t *testing.T) {
	t.Run("七项清单 + 状态随配置翻转", func(t *testing.T) {
		resetDocs(t, validDoc("tos", BillingV1Subscription), validDoc("privacy", BillingV1Subscription))
		store := &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}
		m, err := Wire(Config{Pool: lazyPool(t), Store: store, ProcessorName: func() string { return "Waffo Pancake" }})
		require.NoError(t, err)

		rep := m.Compliance(context.Background())
		require.Len(t, rep.Checks, len(wantCheckIDs), "承诺对账清单固定七项")
		status := map[string]ComplianceCheck{}
		for i, c := range rep.Checks {
			assert.Equal(t, wantCheckIDs[i], c.ID, "清单顺序也稳定（后台卡渲染）")
			assert.NotEmpty(t, c.Label)
			status[c.ID] = c
		}

		assert.Equal(t, CheckOK, status["legal_docs"].Status, "已注册 2 份文档")
		assert.Empty(t, status["legal_docs"].Detail)
		assert.Equal(t, CheckOK, status["payment_processor"].Status, "ProcessorName 回调已接")
		assert.Equal(t, "Waffo Pancake", rep.LegalConfig.ProcessorName)

		// manual 项带 detail：框架无法自检/后续批次项必须解释给管理员看。
		for _, id := range []string{"acceptance_hooks", "account_export", "retention_sweepers", "refund_policy_channel", "server_log_rotation"} {
			assert.Equal(t, CheckManual, status[id].Status, "%s 是人工项", id)
			assert.NotEmpty(t, status[id].Detail, "%s 必须带人工说明", id)
		}
	})

	t.Run("无文档/无处理方 → 两行降级 warn", func(t *testing.T) {
		resetDocs(t)
		m, err := Wire(Config{Pool: lazyPool(t), Store: &fakeStore{}})
		require.NoError(t, err)

		rep := m.Compliance(context.Background())
		status := map[string]ComplianceCheck{}
		for _, c := range rep.Checks {
			status[c.ID] = c
		}
		assert.Equal(t, CheckWarn, status["legal_docs"].Status, "RegisterDocs 未调用")
		assert.NotEmpty(t, status["legal_docs"].Detail)
		assert.Equal(t, CheckWarn, status["payment_processor"].Status, "ProcessorName 未配置")
		assert.NotEmpty(t, status["payment_processor"].Detail)
	})
}

func TestCompliance_SettingsReadFailureDegrades(t *testing.T) {
	// Wire boots against a healthy store; the outage starts AFTER wiring
	// (same shape as TestPublicConfig_UnfilledAndDegraded). A half-empty
	// checklist beats no checklist: the admin endpoint must answer. The
	// degraded shape per Compliance's contract: values resolve empty, so the
	// red-light pass sees "everything unfilled" (a conservative false alarm
	// during an outage, never a 500) and the checklist still comes out whole.
	resetDocs(t, validDoc("tos", BillingV1Subscription))
	store := &fakeStore{eff: map[string]string{KeyBillingModel: BillingV1Subscription}}
	m, err := Wire(Config{Pool: lazyPool(t), Store: store, ProcessorName: func() string { return "Waffo Pancake" }})
	require.NoError(t, err)
	store.effErr = errors.New("db down")

	rep := m.Compliance(context.Background())
	require.Len(t, rep.MissingKeys, 4, "读失败降级为空值视图：红灯按未填写口径全亮（保守误报，不 500）")
	assert.Empty(t, rep.LegalConfig.EntityName)
	assert.Equal(t, "Waffo Pancake", rep.LegalConfig.ProcessorName, "独立来源不受 settings 故障影响")
	require.Len(t, rep.Checks, len(wantCheckIDs), "七项清单照常返回")
}
