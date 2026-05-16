import 'server-only';

import { PLATFORM_PRIMARY_CREDIT_METRIC } from './billing-metrics';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';
import { getRuntimeProduct } from '@/lib/plugin-runtime/loader';

function readBillingMetadata(value: unknown): { primaryCreditMetric?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const billing = (value as Record<string, unknown>).billing;
  if (!billing || typeof billing !== 'object' || Array.isArray(billing)) {
    return null;
  }

  const primaryCreditMetric = (billing as Record<string, unknown>).primaryCreditMetric;
  return typeof primaryCreditMetric === 'string' && primaryCreditMetric.trim()
    ? { primaryCreditMetric: primaryCreditMetric.trim() }
    : null;
}

export function getProductPrimaryCreditMetric(productId = getCurrentRuntimeProductId()): string {
  const product = getRuntimeProduct(productId);
  return readBillingMetadata(product?.metadata)?.primaryCreditMetric ?? PLATFORM_PRIMARY_CREDIT_METRIC;
}
