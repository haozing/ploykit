import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ModuleHostSession } from '../src/lib/module-runtime/host/session';
import {
  createHostCheckout,
  reconcileHostBillingProvider,
} from '../apps/host-next/lib/commercial-provider';
import { getHostRuntimeStore } from '../apps/host-next/lib/runtime-store';

const checkedAt = new Date().toISOString();
const suffix = Date.now().toString(36);
const productId = `billing-reconcile-product-${suffix}`;
const workspaceId = `billing-reconcile-workspace-${suffix}`;
const userId = `billing-reconcile-user-${suffix}`;
const session: ModuleHostSession = {
  user: { id: userId, email: `${userId}@example.com`, role: 'admin' },
  userId,
  actorId: userId,
  productId,
  workspaceId,
};

const checks: Array<{
  id: string;
  ok: boolean;
  durationMs: number;
  detail: Record<string, unknown>;
  error?: string;
}> = [];

async function check(id: string, run: () => Promise<Record<string, unknown>>) {
  const startedAt = Date.now();
  try {
    const detail = await run();
    checks.push({ id, ok: true, durationMs: Date.now() - startedAt, detail });
  } catch (error) {
    checks.push({
      id,
      ok: false,
      durationMs: Date.now() - startedAt,
      detail: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let orderId = '';
let auditId = '';

await check('billing-local-paid-checkout', async () => {
  const checkout = await createHostCheckout(session, 'demo-pro-monthly');
  orderId = checkout.orderId;
  assert.equal(checkout.provider, 'local');
  assert.equal(checkout.status, 'paid');
  return checkout;
});

await check('billing-provider-reconcile-audit', async () => {
  const result = await reconcileHostBillingProvider(session, {
    userId,
    providerOrders: [
      { provider: 'local', providerRef: `local:${orderId}`, status: 'paid' },
      { provider: 'local', providerRef: `local:${orderId}`, status: 'refunded' },
      { provider: 'stripe', providerRef: `missing-${randomUUID()}`, status: 'paid' },
    ],
    reason: 'host billing reconcile smoke',
  });
  auditId = result.auditId;
  assert.equal(result.status, 'discrepancies');
  assert.equal(result.orderReconcile.checked, 3);
  assert.equal(result.orderReconcile.discrepancies.length, 2);
  assert.equal(result.benefitReconcile.repaired, 0);
  assert.equal(result.creditReconcile?.ok, true);
  return {
    status: result.status,
    auditId: result.auditId,
    checked: result.orderReconcile.checked,
    discrepancies: result.orderReconcile.discrepancies,
    benefitReconcile: result.benefitReconcile,
    creditReconcile: result.creditReconcile,
  };
});

await check('billing-provider-reconcile-audit-readable', async () => {
  const runtimeStore = await getHostRuntimeStore();
  const audit = await runtimeStore.store.listAudit({
    productId,
    type: 'host.billing.provider_reconciled',
  });
  const record = audit.find((item) => item.id === auditId);
  assert.ok(record);
  assert.equal(record.metadata.status, 'discrepancies');
  return {
    auditId: record.id,
    type: record.type,
    metadata: record.metadata,
  };
});

const runtimeStore = await getHostRuntimeStore();
const [
  orders,
  invoices,
  subscriptions,
  catalogItems,
  revenueBuckets,
  billingAccount,
] = await Promise.all([
  runtimeStore.store.listCommercialOrders({ productId, workspaceId, userId }),
  runtimeStore.store.listInvoices({ productId, workspaceId, userId }),
  runtimeStore.store.listSubscriptions({ productId, workspaceId, userId }),
  runtimeStore.store.listCommercialCatalogItems({ productId, workspaceId }),
  runtimeStore.store.listRevenueBuckets({ productId, workspaceId }),
  runtimeStore.store.getBillingAccount(productId, userId, workspaceId),
]);
const commercialDomain = {
  orders: orders.length,
  paidOrders: orders.filter((order) => order.status === 'paid').length,
  invoices: invoices.length,
  subscriptions: subscriptions.length,
  catalogItems: catalogItems.length,
  billingAccount: Boolean(billingAccount),
  revenueBuckets: revenueBuckets.length,
  totals: {
    invoiceTotal: invoices.reduce((sum, invoice) => sum + invoice.total, 0),
    revenueGross: revenueBuckets.reduce((sum, bucket) => sum + bucket.gross, 0),
    revenueNet: revenueBuckets.reduce((sum, bucket) => sum + bucket.net, 0),
  },
};
checks.push({
  id: 'billing-commercial-domain-evidence',
  ok:
    commercialDomain.paidOrders >= 1 &&
    commercialDomain.catalogItems >= 2 &&
    commercialDomain.billingAccount &&
    commercialDomain.invoices >= 1 &&
    commercialDomain.subscriptions >= 1 &&
    commercialDomain.revenueBuckets >= 1,
  durationMs: 0,
  detail: { commercialDomain },
});

const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'billing-reconcile',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'billing-reconcile', 'latest.json');
const reportPath = path.join(outputDir, 'billing-reconcile-smoke.json');
const report = {
  ok: checks.every((item) => item.ok),
  required: true,
  profile: 'host-billing-reconcile',
  checkedAt,
  productId,
  workspaceId,
  userId,
  domainEvidence: {
    commercialDomain,
  },
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
