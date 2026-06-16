import type { RuntimeStore, RuntimeStoreTaxProfileRecord } from '../../module-runtime/stores';
import {
  assertAdmin,
  createInvoiceTaxSnapshot,
  normalizeJurisdiction,
  taxValidationStatus,
} from './commercial-ledger-utils';
import type { RuntimeStoreCommercialRuntime } from './commercial-ledger-types';

interface CreateCommercialLedgerTaxInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  now: () => Date;
}

type ValidateTaxProfileInput = Parameters<
  RuntimeStoreCommercialRuntime['admin']['validateTaxProfile']
>[0];

export function createCommercialLedgerTax({ store, scope, now }: CreateCommercialLedgerTaxInput): {
  loadInvoiceTaxSnapshot(userId: string, capturedAt: string): Promise<Record<string, unknown>>;
  validateTaxProfile(input: ValidateTaxProfileInput): Promise<RuntimeStoreTaxProfileRecord>;
} {
  async function loadInvoiceTaxSnapshot(
    userId: string,
    capturedAt: string
  ): Promise<Record<string, unknown>> {
    const [taxProfile, hostUser] = await Promise.all([
      store.getTaxProfile(scope.productId, userId, scope.workspaceId),
      store.getHostUser(userId),
    ]);
    return createInvoiceTaxSnapshot({
      taxProfile,
      hostUserMetadata: hostUser?.metadata ?? {},
      capturedAt,
    });
  }

  async function validateTaxProfile(
    input: ValidateTaxProfileInput
  ): Promise<RuntimeStoreTaxProfileRecord> {
    assertAdmin(input.session);
    const jurisdiction = normalizeJurisdiction(input.jurisdiction);
    const validationStatus = taxValidationStatus(input.profile);
    const record = await store.upsertTaxProfile({
      ...scope,
      userId: input.userId,
      jurisdiction,
      status: validationStatus === 'valid' ? 'validated' : 'invalid',
      validationStatus,
      profile: input.profile,
      evidence: {
        validator: 'host-local-tax-validator',
        checkedAt: now().toISOString(),
        jurisdiction,
        validationStatus,
        ...(input.evidence ?? {}),
      },
      metadata: input.metadata,
    });
    await store.recordAudit({
      ...scope,
      actorId: input.session.actorId ?? input.session.user?.id,
      type: 'commercial.tax_profile.validated',
      metadata: {
        userId: input.userId,
        jurisdiction,
        validationStatus,
      },
    });
    return record;
  }

  return {
    loadInvoiceTaxSnapshot,
    validateTaxProfile,
  };
}
