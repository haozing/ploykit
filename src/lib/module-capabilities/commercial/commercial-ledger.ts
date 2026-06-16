import { HOST_COMMERCIAL_ORDER_STATUS_EVENT_NAME, ModuleCreditsApi } from '@ploykit/module-sdk';
import {
  metadataObject,
  metadataRecord,
  sameSubject,
  subjectFromMetadata,
} from './commercial-ledger-utils';
import { createCommercialAdminRuntime } from './commercial-ledger-admin';
import { createCommercialLedgerBenefits } from './commercial-ledger-benefits';
import { createCommercialLedgerBilling } from './commercial-ledger-billing';
import { createCommercialLedgerCommerce } from './commercial-ledger-commerce';
import { createCommercialLedgerCredits } from './commercial-ledger-credits';
import { createCommercialLedgerEvents } from './commercial-ledger-events';
import { createCommercialLedgerFacts } from './commercial-ledger-facts';
import { createCommercialLedgerMetering } from './commercial-ledger-metering';
import { createCommercialLedgerRedeem } from './commercial-ledger-redeem';
import { createCommercialLedgerRisk } from './commercial-ledger-risk';
import { createCommercialLedgerSubscriptions } from './commercial-ledger-subscriptions';
import { createCommercialLedgerTax } from './commercial-ledger-tax';
import { createCommercialProviderRuntime } from './commercial-ledger-provider';
import type {
  CommercialGuardResult,
  CommercialSkuDefinition,
  CreateRuntimeStoreCommercialRuntimeOptions,
  RuntimeStoreCommercialRequirementCheckInput,
  RuntimeStoreCommercialRuntime,
} from './commercial-ledger-types';
export { normalizeRuntimeStoreEntitlementGrant } from './commercial-ledger-utils';
export type {
  CommercialAdminSessionInput,
  CommercialBenefitReconcileResult,
  CommercialGuardResult,
  CommercialOrderEventPublisher,
  CommercialOrderStatusEventPayload,
  CommercialOrderStatusEventReason,
  CommercialProviderOrderState,
  CommercialProviderPaidInput,
  CommercialProviderRefundInput,
  CommercialReconcileResult,
  CommercialSettlementInput,
  CommercialSkuDefinition,
  CommercialSubscriptionEventInput,
  CreateRuntimeStoreCommercialRuntimeOptions,
  RuntimeStoreCommercialRuntime,
} from './commercial-ledger-types';

export const COMMERCIAL_ORDER_STATUS_EVENT_NAME = HOST_COMMERCIAL_ORDER_STATUS_EVENT_NAME;

export async function checkRuntimeStoreCommercialRequirement(
  input: RuntimeStoreCommercialRequirementCheckInput
): Promise<CommercialGuardResult> {
  const commercial = input.commercial;
  if (!commercial) {
    return { ok: true };
  }

  for (const entitlement of commercial.entitlements ?? []) {
    if (!(await input.billing.hasEntitlement(input.userId, entitlement))) {
      return {
        ok: false,
        code: 'entitlement-denied',
        message: 'Required entitlement is missing.',
      };
    }
  }

  const requiredPlans = commercial.plans ?? [];
  if (requiredPlans.length > 0) {
    const plan = await input.billing.getPlan(input.userId);
    if (!plan || !requiredPlans.includes(plan.id)) {
      return { ok: false, code: 'plan-denied', message: 'Required plan is missing.' };
    }
  }

  if (commercial.credits) {
    const balance = await input.credits.balance(input.userId, commercial.credits.unit);
    if (balance.balance < commercial.credits.amount) {
      return { ok: false, code: 'credits-denied', message: 'Not enough credits.' };
    }
  }

  return { ok: true };
}

export function createRuntimeStoreCommercialRuntime(
  options: CreateRuntimeStoreCommercialRuntimeOptions
): RuntimeStoreCommercialRuntime {
  const now = options.now ?? (() => new Date());
  const planCatalog = options.planCatalog ?? [];
  const skuCatalog = options.skuCatalog ?? {};
  const scope = {
    productId: options.productId,
    workspaceId: options.workspaceId,
  };

  const ledgerSubscriptions = createCommercialLedgerSubscriptions({
    store: options.store,
    scope,
    planCatalog,
  });

  const ledgerCredits = createCommercialLedgerCredits({
    store: options.store,
    scope,
  });

  const ledgerBenefits = createCommercialLedgerBenefits({
    store: options.store,
    scope,
    planCatalog,
    skuCatalog,
    now,
  });

  const ledgerTax = createCommercialLedgerTax({
    store: options.store,
    scope,
    now,
  });

  const ledgerEvents = createCommercialLedgerEvents({
    eventName: COMMERCIAL_ORDER_STATUS_EVENT_NAME,
    events: options.events,
    scope,
  });

  const ledgerFacts = createCommercialLedgerFacts({
    store: options.store,
    scope,
    skuCatalog,
    loadInvoiceTaxSnapshot: ledgerTax.loadInvoiceTaxSnapshot,
  });

  const ledgerCommerce = createCommercialLedgerCommerce({
    store: options.store,
    scope,
    applySkuBenefits: ledgerBenefits.applySkuBenefits,
    reverseOrderBenefits: ledgerBenefits.reverseOrderBenefits,
    expectedMissingBenefits: ledgerBenefits.expectedMissingBenefits,
  });

  const ledgerRedeem = createCommercialLedgerRedeem({
    store: options.store,
    scope,
    now,
    recordCredit: ledgerCredits.recordCredit,
  });

  const ledgerBilling = createCommercialLedgerBilling({
    store: options.store,
    scope,
    planCatalog,
    now,
    redeemCode: ledgerRedeem.redeemCode,
  });

  return {
    forModule(moduleId: string) {
      const credits: ModuleCreditsApi = ledgerCredits.credits;
      const { usage, metering } = createCommercialLedgerMetering({
        store: options.store,
        scope,
        moduleId,
        credits,
        creditBalance: ledgerCredits.creditBalance,
      });

      const billing = ledgerBilling.billing;
      const entitlements = ledgerBilling.entitlements;

      const commerce = ledgerCommerce.commerce;

      const redeemCodes = ledgerRedeem.redeemCodes;

      const risk = createCommercialLedgerRisk({
        store: options.store,
        scope,
        moduleId,
        now,
      });

      return { usage, metering, credits, billing, entitlements, commerce, redeemCodes, risk };
    },
    admin: createCommercialAdminRuntime({
      store: options.store,
      scope,
      creditBalance: ledgerCredits.creditBalance,
      recordCredit: ledgerCredits.recordCredit,
      validateTaxProfile: ledgerTax.validateTaxProfile,
    }),
    provider: createCommercialProviderRuntime({
      store: options.store,
      scope,
      planCatalog,
      skuCatalog,
      now,
      requireScopedOrder: ledgerCommerce.requireScopedOrder,
      assertPaidInputMatchesOrder: ledgerCommerce.assertPaidInputMatchesOrder,
      applySkuBenefits: ledgerBenefits.applySkuBenefits,
      recordCommercialDomainFacts: ledgerFacts.recordCommercialDomainFacts,
      publishOrderStatusEvent: ledgerEvents.publishOrderStatusEvent,
      recordRefundDomainFacts: ledgerFacts.recordRefundDomainFacts,
      reverseOrderBenefits: ledgerBenefits.reverseOrderBenefits,
      expectedMissingBenefits: ledgerBenefits.expectedMissingBenefits,
      findCurrentSubscription: ledgerSubscriptions.findCurrentSubscription,
      subscriptionLastEventAt: ledgerSubscriptions.subscriptionLastEventAt,
      syncSubscriptionEntitlements: ledgerSubscriptions.syncSubscriptionEntitlements,
    }),
  };
}
