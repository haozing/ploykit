package legal

import "context"

// Compliance is the P0-lite admin reconciliation surface (LC-9): what the
// AdminComplianceCard renders. It aggregates three things the module already
// knows — unfilled legal_* settings keys (the red-light list that used to be
// a manual grep over copy placeholders), the resolved legal identity block,
// and a promise-vs-mechanism checklist. "manual" checks are promises the
// framework cannot verify from here (ops-level or later batches) — they are
// surfaced, not guessed.
type Compliance struct {
	MissingKeys []ComplianceMissingKey `json:"missing_keys"`
	LegalConfig ComplianceLegalConfig   `json:"legal_config"`
	Checks      []ComplianceCheck       `json:"checks"`
}

// ComplianceMissingKey is one unfilled required legal_* key.
type ComplianceMissingKey struct {
	Key         string `json:"key"`
	Description string `json:"description"`
}

// ComplianceLegalConfig mirrors the /config legal block's identity subset.
type ComplianceLegalConfig struct {
	EntityName     string `json:"entity_name"`
	Jurisdiction   string `json:"jurisdiction"`
	ProcessorName  string `json:"processor_name"`
	BillingModel   string `json:"billing_model"`
}

// ComplianceCheck statuses: ok (framework verified), warn (action needed),
// manual (promise the framework cannot verify — ops or a later batch).
const (
	CheckOK     = "ok"
	CheckWarn   = "warn"
	CheckManual = "manual"
)

// ComplianceCheck is one promise-vs-mechanism line.
type ComplianceCheck struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// requiredKeys are the legal_* keys that must be filled before the copy is
// truthful; entity_address and legal_min_age are intentionally absent
// (individual operators may leave the address empty; min_age has a sane copy
// default) — they surface via the /config legal block, not as red lights.
var requiredKeys = []string{
	KeyEntityName,
	KeyJurisdiction,
	KeyContactEmail,
	KeyBillingModel,
}

// Compliance builds the admin report. Store read failures degrade to an
// empty report (the card shows what it can) rather than erroring the admin
// endpoint — a half-empty checklist beats no checklist.
func (m *Module) Compliance(ctx context.Context) Compliance {
	eff, err := m.store.Effective(ctx)
	if err != nil {
		m.log.Error("legal: compliance effective read", "err", err)
		eff = map[string]string{}
	}

	specs := map[string]string{}
	for _, s := range KeySpecs() {
		specs[s.Key] = s.Description
	}

	rep := Compliance{
		MissingKeys: []ComplianceMissingKey{},
		LegalConfig: ComplianceLegalConfig{
			EntityName:    eff[KeyEntityName],
			Jurisdiction:  eff[KeyJurisdiction],
			ProcessorName: m.processor(),
			BillingModel:  eff[KeyBillingModel],
		},
		Checks: []ComplianceCheck{},
	}
	for _, k := range requiredKeys {
		if eff[k] == "" {
			rep.MissingKeys = append(rep.MissingKeys, ComplianceMissingKey{
				Key: k, Description: specs[k],
			})
		}
	}

	docs := RegisteredDocs()
	docsStatus, docsDetail := CheckWarn, "RegisterDocs 未调用(或为空)——接受留痕与版本对账无从生效"
	if len(docs) > 0 {
		docsStatus, docsDetail = CheckOK, ""
	}
	procStatus, procDetail := processorCheck(m.processor())
	rep.Checks = append(rep.Checks,
		ComplianceCheck{ID: "legal_docs", Label: "法务文档已注册(版本随代码)", Status: docsStatus, Detail: docsDetail},
		ComplianceCheck{ID: "payment_processor", Label: "支付处理方名称已声明", Status: procStatus, Detail: procDetail},
		ComplianceCheck{ID: "acceptance_hooks", Label: "接受留痕钩子已挂(identity.ChainHooks)", Status: CheckManual,
			Detail: "框架无法自检挂载;确认 legal.Hooks() 与 provisioning 等经 ChainHooks 组合后传入 WithHooks"},
		ComplianceCheck{ID: "account_export", Label: "账号数据导出(DSAR)", Status: CheckManual,
			Detail: "P1 批交付;上线前请勿在隐私政策中承诺自助导出"},
		ComplianceCheck{ID: "retention_sweepers", Label: "保留期清扫工", Status: CheckManual,
			Detail: "P1 批交付;隐私政策中的保留期数字须与实际清扫配置一致"},
		ComplianceCheck{ID: "refund_policy_channel", Label: "渠道侧退款政策与 TOS 口径一致", Status: CheckManual,
			Detail: "MoR 收银台会展示渠道后台保存的退款政策——两处口径必须人工保持一致"},
		ComplianceCheck{ID: "server_log_rotation", Label: "服务器日志轮转(运维)", Status: CheckManual,
			Detail: "框架外;按隐私政策承诺的日志保留期配置 logrotate/nginx"},
	)
	return rep
}

func processorCheck(name string) (string, string) {
	if name != "" {
		return CheckOK, ""
	}
	return CheckWarn, "ProcessorName 回调未配置或当前无已配置渠道——协议中的支付处理方占位符将为空"
}

func (m *Module) processor() string {
	if m.processorName == nil {
		return ""
	}
	return m.processorName()
}
