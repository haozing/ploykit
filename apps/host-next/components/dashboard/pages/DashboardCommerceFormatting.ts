import { HOST_BILLING_SKUS, HOST_PLAN_CATALOG } from '@host/lib/commercial-provider';
import { dashboardInlineText } from '@host/lib/dashboard-copy';
import type { SupportedLanguage } from '@host/lib/i18n';
import { formatCurrencyMinor } from '@host/lib/i18n-format';

export const billingSkuNames: ReadonlyMap<string, string> = new Map(
  HOST_BILLING_SKUS.map((sku) => [sku.id, sku.name])
);
export const billingPlanNames: ReadonlyMap<string, string> = new Map(
  HOST_PLAN_CATALOG.map((plan) => [plan.id, plan.name])
);

export function formatBillingSku(sku: string): string {
  return billingSkuNames.get(sku) ?? sku;
}

export function formatBillingPlan(lang: SupportedLanguage, planId: string | undefined): string {
  if (!planId) {
    return dashboardInlineText(lang, 'free_42f97715');
  }
  return billingPlanNames.get(planId) ?? dashboardInlineText(lang, 'current_plan_45e3ad53');
}

export function formatEntitlementLabel(lang: SupportedLanguage, value: string | undefined): string {
  if (!value) {
    return dashboardInlineText(lang, 'base_access_d18b0eb4');
  }
  if (value === 'public-tools.pro') {
    return dashboardInlineText(lang, 'pro_tools_access_d232c1dd');
  }
  return dashboardInlineText(lang, 'enabled_access_74eac6f9');
}

export function formatCreditUnit(lang: SupportedLanguage, value: string | undefined): string {
  return value === 'credit'
    ? dashboardInlineText(lang, 'credits_8c75616f')
    : dashboardInlineText(lang, 'credits_8c75616f');
}

export function formatCreditReason(lang: SupportedLanguage, reason: string): string {
  if (reason === 'host.welcome_grant' || reason === 'welcome_bonus') {
    return dashboardInlineText(lang, 'welcome_bonus_0439221e');
  }
  if (reason === 'host.public_tool_usage' || reason === 'public_tool_usage') {
    return dashboardInlineText(lang, 'public_tool_usage_485b0697');
  }
  return dashboardInlineText(lang, 'credit_adjustment_5ca70ea2');
}

export function formatCreditAmount(lang: SupportedLanguage, amount: number, unit: string): string {
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${amount} ${formatCreditUnit(lang, unit)}`;
}

export function formatOrderAmount(
  lang: SupportedLanguage,
  amount: number,
  currency: string
): string {
  if (amount === 0) {
    return dashboardInlineText(lang, 'free_demo_order_5fc6871d');
  }
  return formatCurrencyMinor(amount, currency, lang);
}

export function formatMoneyAmount(
  lang: SupportedLanguage,
  amount: number,
  currency: string
): string {
  if (amount === 0) {
    return dashboardInlineText(lang, 'free_b34fd7a2');
  }
  return formatCurrencyMinor(amount, currency, lang);
}

export function formatPaymentMethodLabel(
  lang: SupportedLanguage,
  label: string,
  provider?: string
): string {
  if (label === 'Local ledger checkout' || provider === 'local') {
    return dashboardInlineText(lang, 'demo_payment_ee7b8c01');
  }
  return label;
}
