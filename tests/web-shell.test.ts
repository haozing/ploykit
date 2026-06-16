import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import {
  createInMemoryRuntimeStore,
} from '../src/lib/module-runtime';
import { sendHostEmail } from '../apps/host-next/lib/email-provider';
import { getAdminOperationsView } from '../apps/host-next/lib/admin-module-operations';
import { applyAdminAuditRetention } from '../apps/host-next/lib/admin-audit';
import {
  bulkUpdateAdminFiles,
  cleanupAdminDeletedFiles,
  deleteAdminFile,
  getAdminFileDetailView,
  getAdminFilesView,
} from '../apps/host-next/lib/admin-files';
import {
  getAdminHostSettingsView,
  updateAdminHostSettings,
} from '../apps/host-next/lib/admin-settings';
import { getAdminAnalytics } from '../apps/host-next/lib/admin-api';
import {
  createRuntimeStoreHostAuthAdapter,
  createHostSessionCookie,
  createHostSessionCookieForSession,
  getHostAuthAdapter,
  ensureHostIdentitySeeded,
} from '../apps/host-next/lib/auth';
import {
  uploadHostUserFile,
} from '../apps/host-next/lib/files';
import { getHostRuntime, getHostRuntimeHealth } from '../apps/host-next/lib/create-host';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';
import { createDemoHostSession } from '../apps/host-next/lib/module-host';
import { checkHostRouteSecurity } from '../apps/host-next/lib/security';
import { createHostRequest } from '../apps/host-next/lib/paths';
import { GET as getNotificationsHistory } from '../apps/host-next/app/api/notifications/history/route';
import { PATCH as updateNotificationPreferences } from '../apps/host-next/app/api/notifications/preferences/route';
import { POST as markNotificationRead } from '../apps/host-next/app/api/notifications/[notificationId]/read/route';
import { GET as getAdminAuditApi } from '../apps/host-next/app/api/admin/audit/route';

type WebShellTestCallback = (context: unknown) => void | Promise<void>;
type WebShellTestOptions = Record<string, unknown>;
type WebShellTestRunner = {
  (name: string, fn: WebShellTestCallback): void;
  (name: string, options: WebShellTestOptions, fn: WebShellTestCallback): void;
};

const runNodeTest = nodeTest as unknown as WebShellTestRunner;
let webShellTestQueue: Promise<void> = Promise.resolve();

const test: WebShellTestRunner = ((
  name: string,
  optionsOrFn: WebShellTestOptions | WebShellTestCallback,
  maybeFn?: WebShellTestCallback
) => {
  const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn;
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;

  if (!fn) {
    throw new Error(`WEB_SHELL_TEST_CALLBACK_MISSING: ${name}`);
  }

  const queued = async (context: unknown) => {
    const run = webShellTestQueue.then(() => fn(context));
    webShellTestQueue = run.then(
      () => undefined,
      () => undefined
    );
    await run;
  };

  const testOptions = { ...(options ?? {}), concurrency: false };

  if (options) {
    runNodeTest(name, testOptions, queued);
  } else {
    runNodeTest(name, testOptions, queued);
  }
}) as WebShellTestRunner;

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    Reflect.set(process.env, name, value);
  }
}

async function withDemoHostUsers<T>(run: () => T | Promise<T>): Promise<T> {
  const previousDemoUsers = process.env.PLOYKIT_ENABLE_DEMO_USERS;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.PLOYKIT_ENABLE_DEMO_USERS = 'true';
  if (process.env.NODE_ENV === 'production') {
    restoreEnvValue('NODE_ENV', 'test');
  }
  try {
    return await run();
  } finally {
    restoreEnvValue('PLOYKIT_ENABLE_DEMO_USERS', previousDemoUsers);
    restoreEnvValue('NODE_ENV', previousNodeEnv);
  }
}

async function seedDemoHostIdentity(
  store?: Parameters<typeof ensureHostIdentitySeeded>[0]
): Promise<void> {
  const targetStore = store ?? (await getHostRuntime()).runtimeStore.store;
  await withDemoHostUsers(() => ensureHostIdentitySeeded(targetStore));
}

test('X9 notifications are store-backed, readable and honor preferences', async () => {
  await seedDemoHostIdentity();
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const hostRuntime = await getHostRuntime();
  const sku = `x9-muted-${Date.now()}`;
  const previousEmailProvider = process.env.PLOYKIT_EMAIL_PROVIDER;
  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  };
  process.env.PLOYKIT_EMAIL_PROVIDER = 'log';

  try {
    const disabledResponse = await updateNotificationPreferences(
      createHostRequest('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ billing: false }),
      })
    );
    assert.equal(disabledResponse.status, 200);

    const order = await hostRuntime.runtimeStore.store.createCommercialOrder({
      productId: 'demo-product',
      workspaceId: 'demo-workspace',
      userId: 'demo-admin',
      sku,
      amount: 0,
      currency: 'USD',
      provider: 'local',
      idempotencyKey: sku,
    });
    await hostRuntime.runtimeStore.store.updateCommercialOrderStatus(order.id, 'paid');

    const mutedHistoryResponse = await getNotificationsHistory(
      createHostRequest('/api/notifications/history', { headers: { cookie } })
    );
    const mutedHistory = (await mutedHistoryResponse.json()) as {
      ok: boolean;
      data: { notifications: { id: string; title: string; status: string }[] };
    };
    const skippedDeliveries = await hostRuntime.runtimeStore.store.listNotificationDeliveries({
      productId: 'demo-product',
      userId: 'demo-admin',
      status: 'skipped',
    });
    assert.equal(mutedHistoryResponse.status, 200);
    assert.equal(
      mutedHistory.data.notifications.some((item) => item.title.includes(sku)),
      false
    );
    assert.ok(skippedDeliveries.some((item) => item.reason === 'disabled_by_preferences'));

    const enabledResponse = await updateNotificationPreferences(
      createHostRequest('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ billing: true, email: true }),
      })
    );
    assert.equal(enabledResponse.status, 200);

    const run = await hostRuntime.runtimeStore.store.createRun({
      productId: 'demo-product',
      workspaceId: 'demo-workspace',
      moduleId: 'public-tools-demo',
      kind: 'manual',
      name: 'x9-notification-task',
      idempotencyKey: `x9-notification-task:${Date.now()}`,
    });
    await hostRuntime.runtimeStore.store.updateRunStatus(run.id, 'succeeded', { progress: 100 });

    const historyResponse = await getNotificationsHistory(
      createHostRequest('/api/notifications/history', { headers: { cookie } })
    );
    const history = (await historyResponse.json()) as {
      ok: boolean;
      data: { notifications: { id: string; runId?: string; status: string }[] };
    };
    const taskNotification = history.data.notifications.find((item) => item.runId === run.id);
    assert.ok(taskNotification);

    const emailDeliveries = await hostRuntime.runtimeStore.store.listNotificationDeliveries({
      productId: 'demo-product',
      userId: 'demo-admin',
      provider: 'email-log',
    });
    assert.ok(emailDeliveries.some((item) => item.notificationId === taskNotification.id));

    const readResponse = await markNotificationRead(
      createHostRequest(`/api/notifications/${taskNotification.id}/read`, {
        method: 'POST',
        headers: { cookie },
      }),
      { params: Promise.resolve({ notificationId: taskNotification.id }) }
    );
    const readBody = (await readResponse.json()) as {
      ok: boolean;
      data: { notification: { status: string } };
    };
    assert.equal(readResponse.status, 200);
    assert.equal(readBody.data.notification.status, 'read');
  } finally {
    restoreEnv('PLOYKIT_EMAIL_PROVIDER', previousEmailProvider);
  }
});

test('X3 host auth adapter supports registration, verification, sessions and reset', async () => {
  const store = createInMemoryRuntimeStore();
  const adapter = createRuntimeStoreHostAuthAdapter(store);
  const registered = await adapter.register({
    email: 'new-user@example.com',
    password: 'NewUser@123',
    displayName: 'New User',
  });

  assert.equal(registered.user.status, 'pending-verification');
  assert.equal(await adapter.authenticate('new-user@example.com', 'NewUser@123'), null);

  const verified = await adapter.verifyEmail(registered.emailVerificationToken);
  assert.equal(verified.status, 'active');
  const authenticated = await adapter.authenticate('new-user@example.com', 'NewUser@123');
  assert.ok(authenticated);

  const createdSession = await adapter.createSession(authenticated);
  const resolved = await adapter.resolveSession(createdSession.cookie);
  assert.equal(resolved.user?.id, authenticated.id);
  assert.equal((await adapter.listSessions(authenticated.id)).length, 1);

  await adapter.revokeSession(authenticated.id, createdSession.session.id);
  const revoked = await adapter.resolveSession(createdSession.cookie);
  assert.equal(revoked.user, null);

  const reset = await adapter.requestPasswordReset('new-user@example.com');
  assert.equal(reset.sent, true);
  assert.ok(reset.resetToken);
  await adapter.resetPassword(reset.resetToken, 'Changed@123');
  assert.equal(await adapter.authenticate('new-user@example.com', 'NewUser@123'), null);
  assert.ok(await adapter.authenticate('new-user@example.com', 'Changed@123'));
});

test('X3 signed session cookie falls back when memory store has no session table entry', async () => {
  const store = createInMemoryRuntimeStore();
  await seedDemoHostIdentity(store);
  const adapter = createRuntimeStoreHostAuthAdapter(store);
  const cookie = createHostSessionCookieForSession('demo-admin', 'external-session').split(';')[0]!;

  const resolved = await adapter.resolveSession(cookie);
  assert.equal(resolved.user?.id, 'demo-admin');
});

test('K5 admin catalog seed preserves persisted module state', async () => {
  const hostRuntime = await getHostRuntime();
  await hostRuntime.runtimeStore.store.upsertCatalogState({
    productId: 'demo-product',
    moduleId: 'hello',
    status: 'disabled',
    bundleId: 'operator',
    required: false,
    scopeProfile: 'explicit-workspace',
  });

  try {
    await getAdminOperationsView();
    const helloState = (
      await hostRuntime.runtimeStore.store.listCatalogStates({ productId: 'demo-product' })
    ).find((state) => state.moduleId === 'hello');

    assert.equal(helloState?.status, 'disabled');
    assert.equal(helloState?.bundleId, 'operator');
    assert.equal(helloState?.required, false);
    assert.equal(helloState?.scopeProfile, 'explicit-workspace');
  } finally {
    await hostRuntime.runtimeStore.store.upsertCatalogState({
      productId: 'demo-product',
      moduleId: 'hello',
      status: 'enabled',
      bundleId: 'demo',
      required: true,
      scopeProfile: 'hidden-default',
    });
  }
});

test('A8/A9 admin analytics, edge access and audit retention expose operational evidence', async () => {
  await seedDemoHostIdentity();
  const session = createDemoHostSession();
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const jsonExport = await getAdminAuditApi(
    createHostRequest('/api/admin/audit?format=json&limit=5', {
      headers: { cookie },
    })
  );
  const exportBody = (await jsonExport.json()) as { items: unknown[] };
  await new Promise((resolve) => setTimeout(resolve, 20));
  const analytics = await getAdminAnalytics({ range: '90d' });
  await applyAdminAuditRetention(session, {
    retentionDays: 30,
    mode: 'archive',
    reason: 'web-shell retention test',
  });
  const hostRuntime = await getHostRuntime();
  const auditLogs = await hostRuntime.runtimeStore.store.listAudit({ productId: 'demo-product' });

  assert.equal(jsonExport.status, 200);
  assert.match(jsonExport.headers.get('content-disposition') ?? '', /\.json"/);
  assert.ok(Array.isArray(exportBody.items));
  assert.ok(typeof analytics.revenueMetrics.mrr === 'number');
  assert.ok(typeof analytics.growthMetrics.signups === 'number');
  assert.ok(typeof analytics.usagePatterns.peak === 'number');
  assert.ok(Array.isArray(analytics.cohorts));
  assert.ok(Array.isArray(analytics.edgeAccessLogs));
  assert.ok(
    auditLogs.some(
      (record) =>
        record.type === 'admin.audit.retention_applied' &&
        record.metadata.reason === 'web-shell retention test'
    )
  );
});

test('A10/A11 admin files and host settings perform durable mutations with audit-backed policy', async () => {
  const session = createDemoHostSession();
  const hostRuntime = await getHostRuntime();
  const suffix = Date.now().toString(36);
  const file = await hostRuntime.runtimeStore.store.createFile({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'web-shell',
    ownerId: 'demo-admin',
    name: `ops-${suffix}.txt`,
    purpose: 'source',
    status: 'ready',
    visibility: 'private',
    contentType: 'text/plain',
    sizeBytes: 42,
    storageKey: `ops/${suffix}.txt`,
    metadata: { folder: 'ops' },
  });

  const archivedFiles = await bulkUpdateAdminFiles(session, {
    fileIds: [file.id],
    action: 'archive',
    reason: 'web-shell bulk archive test',
  });
  const filesView = await getAdminFilesView();
  const settings = await updateAdminHostSettings(session, {
    siteName: 'PloyKit Ops',
    supportEmail: 'support@example.com',
    defaultLocale: 'zh',
    timezone: 'Asia/Hong_Kong',
    requireEmailVerification: true,
    sessionMaxAgeDays: 7,
    passwordMinLength: 8,
    emailProvider: 'log',
    fromEmail: 'ops-no-reply@example.com',
    fromName: 'PloyKit Ops',
    digestFrequency: 'daily',
  });
  const savedSettings = await getAdminHostSettingsView();
  await assert.rejects(
    () => updateAdminHostSettings(session, { emailProvider: 'smtp' }),
    /ADMIN_SETTINGS_INVALID:emailProvider/
  );
  await assert.rejects(
    () => updateAdminHostSettings(session, { fromEmail: 'not-an-email' }),
    /ADMIN_SETTINGS_INVALID:fromEmail/
  );
  await assert.rejects(
    () => updateAdminHostSettings(session, { timezone: 'Mars/Base' }),
    /ADMIN_SETTINGS_INVALID:timezone/
  );
  await assert.rejects(
    () => updateAdminHostSettings(session, { sessionMaxAgeDays: 366 }),
    /ADMIN_SETTINGS_INVALID:sessionMaxAgeDays/
  );
  const emailResult = await sendHostEmail({
    to: 'ops@example.com',
    subject: 'Settings smoke',
    text: 'settings smoke',
    emailId: `settings-smoke-${suffix}`,
    correlationId: `settings-smoke-${suffix}`,
    metadata: { source: 'web-shell-test' },
  });
  const emailMetadata = emailResult.metadata as { from?: string } | undefined;
  const emailDeliveries = await hostRuntime.runtimeStore.store.listDeliveries({
    productId: 'demo-product',
    kind: 'email',
    correlationId: `settings-smoke-${suffix}`,
  });
  const refreshedHealth = await getHostRuntimeHealth();
  const settingsAudit = await hostRuntime.runtimeStore.store.listAudit({
    productId: 'demo-product',
    type: 'admin.settings.updated',
  });
  const latestSettingsAudit = [...settingsAudit]
    .reverse()
    .find((record) => record.metadata.version === savedSettings.version);
  const settingsDiff = latestSettingsAudit?.metadata.diff as
    | Array<{ key: string; next?: unknown; requiresRestart?: boolean }>
    | undefined;
  const fromEmailField = savedSettings.fields.find((field) => field.key === 'fromEmail');

  assert.equal(archivedFiles[0]?.status, 'archived');
  assert.equal(filesView.files.find((item) => item.id === file.id)?.status, 'archived');
  assert.equal(settings.siteName, 'PloyKit Ops');
  assert.equal(savedSettings.source, 'admin-override');
  assert.equal(savedSettings.fieldSources.fromEmail, 'admin-override');
  assert.equal(fromEmailField?.source, 'admin-override');
  assert.equal(fromEmailField?.requiresRestart, false);
  assert.equal(savedSettings.digestFrequency, 'daily');
  assert.equal(emailResult.provider, 'email-log');
  assert.equal(emailMetadata?.from, 'PloyKit Ops <ops-no-reply@example.com>');
  assert.equal(refreshedHealth.providers.email.from, 'PloyKit Ops <ops-no-reply@example.com>');
  assert.equal(emailDeliveries[0]?.emailId, `settings-smoke-${suffix}`);
  assert.equal(emailDeliveries[0]?.status, 'delivered');
  assert.ok(latestSettingsAudit);
  assert.equal('settings' in latestSettingsAudit.metadata, false);
  assert.equal(latestSettingsAudit.metadata.requiresRestart, false);
  assert.ok(
    settingsDiff?.some((item) => item.key === 'fromEmail' && item.next === '[REDACTED_EMAIL]')
  );
});

test('D22 admin file detail reports storage object and cleanup drilldown', async () => {
  const session = createDemoHostSession();
  const uploaded = await uploadHostUserFile(session, {
    moduleId: 'web-shell',
    name: `detail-${Date.now().toString(36)}.txt`,
    purpose: 'source',
    contentType: 'text/plain',
    content: 'admin file detail smoke',
  });

  const readyDetail = await getAdminFileDetailView(uploaded.file.id);
  assert.equal(readyDetail.storageObject?.status, 'present');
  assert.equal(readyDetail.storageObject?.sizeBytes, 'admin file detail smoke'.length);
  assert.equal(readyDetail.access?.mediaGateway, 'signed');
  assert.equal(readyDetail.cleanup?.eligible, false);
  assert.equal(readyDetail.cleanup?.physicalObjectPresent, true);

  await deleteAdminFile(session, uploaded.file.id);
  const deletedDetail = await getAdminFileDetailView(uploaded.file.id);
  assert.equal(deletedDetail.file?.status, 'deleted');
  assert.equal(deletedDetail.access?.mediaGateway, 'blocked');
  assert.equal(deletedDetail.cleanup?.eligible, true);
  assert.equal(deletedDetail.storageObject?.status, 'present');

  await cleanupAdminDeletedFiles(session);
  const cleanedDetail = await getAdminFileDetailView(uploaded.file.id);
  assert.equal(cleanedDetail.storageObject?.status, 'missing');
  assert.equal(cleanedDetail.cleanup?.physicalObjectPresent, false);
  assert.ok(cleanedDetail.cleanup?.latestCleanupAt);
  const cleanupAudit = cleanedDetail.audit.find(
    (record) => record.type === 'admin.file.cleanup_deleted'
  );
  assert.ok(cleanupAudit);
  assert.deepEqual(cleanupAudit.metadata.fileIds, [uploaded.file.id]);

  const filesView = await getAdminFilesView();
  assert.equal(filesView.reconcile.command, 'npm run host:files-reconcile-smoke');
  assert.ok(typeof filesView.reconcile.issues === 'number');
});
