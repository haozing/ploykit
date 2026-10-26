package legal

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/haozing/ploykit/settings"
)

// The legal_* settings key group (LC-1, audit L5): legal identity values the
// framework registers on the settings store so products never copy KeySpecs
// by hand — every key lands on the generic admin settings card with env
// fallback for free. All six are deliberately NON-sensitive (they feed the
// public /config legal block); none may ever seal or mask.

const (
	KeyEntityName    = "legal_entity_name"
	KeyEntityAddress = "legal_entity_address"
	KeyJurisdiction  = "legal_jurisdiction"
	KeyContactEmail  = "legal_contact_email"
	KeyBillingModel  = "legal_billing_model"
	KeyMinAge        = "legal_min_age"
)

// knownPlaceholders is the closed set a Doc.Placeholders entry may name:
// the six legal_* settings keys plus the two live-value placeholders the
// Wire callbacks resolve (payment_processor_name via Config.ProcessorName,
// site_url via Config.SiteURL). Keeping this a closed set is what turns
// "copy references a variable nobody fills" into a boot-time error.
var knownPlaceholders = map[string]bool{
	KeyEntityName:            true,
	KeyEntityAddress:         true,
	KeyJurisdiction:          true,
	KeyContactEmail:          true,
	KeyBillingModel:          true,
	KeyMinAge:                true,
	"payment_processor_name": true,
	"site_url":               true,
}

var legalEmailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// KeySpecs returns the whole legal_* key group in display order. Wire
// registers them; the descriptions double as the admin card's field help.
// Empty values are valid everywhere in this group: an unfilled legal key is
// a first-class state the compliance card red-lights, not a validation
// error.
func KeySpecs() []settings.KeySpec {
	return []settings.KeySpec{
		{
			Key:         KeyEntityName,
			Env:         "LEGAL_ENTITY_NAME",
			Description: "法定名称：个人经营者填个人法定姓名（如 Zhang San），公司填注册全称（如 Acme Pte. Ltd.）——用于条款/隐私政策的主体占位符；缺值时合规对账卡亮红灯",
			Validate: func(v string) error {
				return cappedLen(v, 200, KeyEntityName)
			},
		},
		{
			Key:         KeyEntityAddress,
			Env:         "LEGAL_ENTITY_ADDRESS",
			Description: "注册地址：公司填注册办公地址（如 1 Example Street, Singapore 089xxx）；个人经营者可留空（对账卡提示但不阻断）",
			Validate: func(v string) error {
				return cappedLen(v, 500, KeyEntityAddress)
			},
		},
		{
			Key:         KeyJurisdiction,
			Env:         "LEGAL_JURISDICTION",
			Description: "管辖法表述，写入条款 governing law 条款（如 the laws of Singapore / 中华人民共和国法律）",
			Validate: func(v string) error {
				return cappedLen(v, 200, KeyJurisdiction)
			},
		},
		{
			Key:         KeyContactEmail,
			Env:         "LEGAL_CONTACT_EMAIL",
			Description: "法务/隐私统一联系邮箱（如 legal@example.com）：隐私政策与 DSAR（数据主体请求）的联系入口；空 = 未配置（对账卡红灯）",
			Validate:    validateContactEmail,
		},
		{
			Key:         KeyBillingModel,
			Env:         "LEGAL_BILLING_MODEL",
			Description: "计费模式三选一：v1_subscription（订阅）/ v2_credits（积分）/ v3_hybrid（混合）——必须与 RegisterDocs 里 Doc.BillingModel 的声明一致，不一致时启动直接失败（模板三选一对账自动化）；未填时默认 v1_subscription（开箱最常见模式），声明 v2/v3 的站点经 settings/env 覆盖",
			Default:     BillingV1Subscription,
			Validate:    validateBillingModel,
		},
		{
			Key:         KeyMinAge,
			Env:         "LEGAL_MIN_AGE",
			Description: "最低年龄声明（COPPA/GDPR 文案提醒用）：13 或 16 等整数，写入注册年龄门槛文案；空 = 文案不声明",
			Validate:    validateMinAge,
		},
	}
}

func validateContactEmail(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil // unfilled is a state, surfaced by the compliance card
	}
	if len(v) > 254 || !legalEmailRe.MatchString(v) {
		return fmt.Errorf("%s 必须是合法邮箱地址（如 legal@example.com）或空", KeyContactEmail)
	}
	return nil
}

func validateBillingModel(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil // Wire reconciles docs vs setting at boot
	}
	if !billingModels[v] {
		return fmt.Errorf("%s 必须是 %s / %s / %s 三者之一（或留空走默认 %s）",
			KeyBillingModel, BillingV1Subscription, BillingV2Credits, BillingV3Hybrid, BillingV1Subscription)
	}
	return nil
}

func validateMinAge(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > 99 {
		return fmt.Errorf("%s 必须是 1..99 的整数（如 13 或 16）或空", KeyMinAge)
	}
	return nil
}

// cappedLen is the shared "free text under a length cap" validator (runes,
// not bytes: these are human-typed names and addresses).
func cappedLen(v string, maxLen int, key string) error {
	if r := len([]rune(v)); r > maxLen {
		return fmt.Errorf("%s 最多 %d 字符（当前 %d）", key, maxLen, r)
	}
	return nil
}
