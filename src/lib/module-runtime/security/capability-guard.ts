import {
  Permission,
  type CommercialSubject,
  type ModuleArtifactsApi,
  type ModuleAiApi,
  type ModuleApiKeysApi,
  type ModuleAuditApi,
  type ModuleBillingApi,
  type ModuleCacheApi,
  type ModuleCommerceApi,
  type ModuleConfigApi,
  type ModuleConnectorsApi,
  type ModuleContext,
  type ModuleCreditsApi,
  type ModuleDataApi,
  type ModuleDataDocument,
  type ModuleDataTable,
  type ModuleEntitlementsApi,
  type ModuleEventsApi,
  type ModuleFilesApi,
  type ModuleHttpApi,
  type ModuleJobsApi,
  type ModuleMeteringApi,
  type ModuleNotificationsApi,
  type ModuleRagApi,
  type ModuleRedeemCodesApi,
  type ModuleRateLimitApi,
  type ModuleRiskApi,
  type ModuleResourceBindingsApi,
  type ModuleRunsApi,
  type ModuleSecretsApi,
  type ModuleServiceInvokeOptions,
  type ModuleServicesApi,
  type ModuleUsageApi,
  type ModuleWebhooksApi,
  type PermissionValue,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeAccessSession } from './session';
import {
  assertConfigDeclared,
  assertOptionalSubjectAccess,
  assertOwnUser,
  assertPermission,
  assertPrivilegedCommercialMaintenance,
  assertResourceBindingDeclared,
  assertResourceBindingWritePermission,
  assertServiceDeclared,
  assertSubjectAccess,
  deny,
  filterAccessibleSubjects,
  subjectFromInput,
  userCommercialSubject,
} from './capability-guard-common';

export interface GuardModuleContextCapabilitiesInput {
  context: ModuleContext;
  contract: ModuleRuntimeContract;
  session: ModuleRuntimeAccessSession;
}

function guardDataDocument<TRecord>(
  document: ModuleDataDocument<TRecord>,
  guardRead: () => void,
  guardWrite: () => void
): ModuleDataDocument<TRecord> {
  return {
    async findMany(query) {
      guardRead();
      return document.findMany(query);
    },
    async findOne(query) {
      guardRead();
      return document.findOne(query);
    },
    async findById(id) {
      guardRead();
      return document.findById(id);
    },
    async insert(input) {
      guardWrite();
      return document.insert(input);
    },
    async insertMany(input) {
      guardWrite();
      return document.insertMany(input);
    },
    async insertIfAbsent(input, options) {
      guardWrite();
      return document.insertIfAbsent(input, options);
    },
    async upsert(input, options) {
      guardWrite();
      return document.upsert(input, options);
    },
    async update(id, input) {
      guardWrite();
      return document.update(id, input);
    },
    async updateWhere(query, input) {
      guardWrite();
      return document.updateWhere(query, input);
    },
    async delete(id) {
      guardWrite();
      return document.delete(id);
    },
    async claim(query, patch) {
      guardWrite();
      return document.claim(query, patch);
    },
    async count(query) {
      guardRead();
      return document.count(query);
    },
    async exists(query) {
      guardRead();
      return document.exists(query);
    },
  };
}

function guardDataTable<TRecord>(
  table: ModuleDataTable<TRecord>,
  guardRead: () => void,
  guardWrite: () => void
): ModuleDataTable<TRecord> {
  return {
    async findMany(query) {
      guardRead();
      return table.findMany(query);
    },
    async findOne(query) {
      guardRead();
      return table.findOne(query);
    },
    async findById(id) {
      guardRead();
      return table.findById(id);
    },
    async insert(input) {
      guardWrite();
      return table.insert(input);
    },
    async insertMany(input) {
      guardWrite();
      return table.insertMany(input);
    },
    async insertIfAbsent(input, options) {
      guardWrite();
      return table.insertIfAbsent(input, options);
    },
    async upsert(input, options) {
      guardWrite();
      return table.upsert(input, options);
    },
    async update(id, input) {
      guardWrite();
      return table.update(id, input);
    },
    async updateWhere(query, input) {
      guardWrite();
      return table.updateWhere(query, input);
    },
    async delete(id) {
      guardWrite();
      return table.delete(id);
    },
    async count(query) {
      guardRead();
      return table.count(query);
    },
    async exists(query) {
      guardRead();
      return table.exists(query);
    },
    async softDelete(id) {
      guardWrite();
      return table.softDelete(id);
    },
    async restore(id) {
      guardWrite();
      return table.restore(id);
    },
  };
}

function guardData(
  data: ModuleDataApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleDataApi {
  const permission = (value: PermissionValue, path: string) =>
    assertPermission(contract, session, value, path);
  return {
    document<TRecord = Record<string, unknown>>(name: string) {
      return guardDataDocument(
        data.document<TRecord>(name),
        () => permission(Permission.DataDocumentRead, `ctx.data.document(${name}).read`),
        () => permission(Permission.DataDocumentWrite, `ctx.data.document(${name}).write`)
      );
    },
    table<TRecord = Record<string, unknown>>(name: string) {
      return guardDataTable(
        data.table<TRecord>(name),
        () => permission(Permission.DataTableRead, `ctx.data.table(${name}).read`),
        () => permission(Permission.DataTableWrite, `ctx.data.table(${name}).write`)
      );
    },
    async transaction(callback) {
      permission(Permission.DataTransaction, 'ctx.data.transaction');
      return data.transaction((tx) => callback(guardData(tx, contract, session)));
    },
    tableRef(name) {
      permission(Permission.DataSqlRead, 'ctx.data.tableRef');
      return data.tableRef(name);
    },
    viewRef(name) {
      permission(Permission.DataSqlRead, 'ctx.data.viewRef');
      return data.viewRef(name);
    },
    sql: {
      async query(statement) {
        permission(Permission.DataSqlRead, 'ctx.data.sql.query');
        permission(Permission.UnsafeSqlRaw, 'ctx.data.sql.query.raw');
        return data.sql.query(statement);
      },
      async execute(statement) {
        permission(Permission.DataSqlWrite, 'ctx.data.sql.execute');
        permission(Permission.UnsafeSqlRaw, 'ctx.data.sql.execute.raw');
        return data.sql.execute(statement);
      },
    },
  };
}

function guardConfig(
  api: ModuleConfigApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleConfigApi {
  return {
    async get(key) {
      assertPermission(contract, session, Permission.ConfigRead, 'ctx.config.get');
      assertConfigDeclared(contract, key, false);
      return api.get(key);
    },
    async require(key) {
      assertPermission(contract, session, Permission.ConfigRead, 'ctx.config.require');
      assertConfigDeclared(contract, key, false);
      return api.require(key);
    },
  };
}

function guardSecrets(
  api: ModuleSecretsApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleSecretsApi {
  return {
    async get(name) {
      assertPermission(contract, session, Permission.SecretsRead, 'ctx.secrets.get');
      assertConfigDeclared(contract, name, true);
      return api.get(name);
    },
    async require(name) {
      assertPermission(contract, session, Permission.SecretsRead, 'ctx.secrets.require');
      assertConfigDeclared(contract, name, true);
      return api.require(name);
    },
  };
}

function guardServices(
  api: ModuleServicesApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleServicesApi {
  type GuardedServiceInvokeArgs =
    | [name: string, input: unknown, options?: ModuleServiceInvokeOptions]
    | [name: string, operation: string, input: unknown, options?: ModuleServiceInvokeOptions];

  const invoke = (async (...args: GuardedServiceInvokeArgs): Promise<unknown> => {
    const [name, operationOrInput, inputOrOptions, options] = args;
    assertPermission(contract, session, Permission.ServicesInvoke, 'ctx.services.invoke');
    assertServiceDeclared(contract, name);
    const requirement = contract.serviceRequirements[name];
    const hasOperation = typeof operationOrInput === 'string' && args.length >= 3;
    if (!hasOperation) {
      if (requirement?.operations && Object.keys(requirement.operations).length > 0) {
        throw new Error(`MODULE_CAPABILITY_SERVICE_OPERATION_REQUIRED: ${name}`);
      }
      return api.invoke(name, operationOrInput, inputOrOptions as ModuleServiceInvokeOptions);
    }
    const operation = operationOrInput;
    if (requirement?.operations && !requirement.operations[operation]) {
      throw new Error(`MODULE_CAPABILITY_SERVICE_OPERATION_NOT_DECLARED: ${name}.${operation}`);
    }
    return api.invoke(name, operation, inputOrOptions, options);
  }) as ModuleServicesApi['invoke'];

  return {
    invoke,
  };
}

function guardConnectors(
  api: ModuleConnectorsApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleConnectorsApi {
  return {
    async get(name) {
      assertPermission(contract, session, Permission.ConnectorsRead, 'ctx.connectors.get');
      assertServiceDeclared(contract, name);
      return api.get(name);
    },
    async invoke(name, operation, input) {
      assertPermission(contract, session, Permission.ConnectorsInvoke, 'ctx.connectors.invoke');
      assertServiceDeclared(contract, name);
      return api.invoke(name, operation, input);
    },
  };
}

function guardResourceBindings(
  api: ModuleResourceBindingsApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleResourceBindingsApi {
  return {
    async get(name) {
      assertPermission(
        contract,
        session,
        Permission.ResourceBindingsRead,
        'ctx.resourceBindings.get'
      );
      assertResourceBindingDeclared(contract, name);
      return api.get(name);
    },
    async list(kind) {
      assertPermission(
        contract,
        session,
        Permission.ResourceBindingsRead,
        'ctx.resourceBindings.list'
      );
      return api.list(kind);
    },
    async upsert(name, value, options) {
      assertResourceBindingWritePermission(contract, session, 'ctx.resourceBindings.upsert');
      assertResourceBindingDeclared(contract, name);
      if (!api.upsert) {
        deny(
          'MODULE_CAPABILITY_UNAVAILABLE',
          'ctx.resourceBindings.upsert is not mounted by this host.'
        );
      }
      return api.upsert(name, value, options);
    },
  };
}

function guardHttp(
  api: ModuleHttpApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleHttpApi {
  return {
    async fetch(input, init) {
      assertPermission(contract, session, Permission.ExternalHttp, 'ctx.http.fetch');
      return api.fetch(input, init);
    },
  };
}

function guardFiles(
  api: ModuleFilesApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleFilesApi {
  const permission = (value: PermissionValue, path: string) =>
    assertPermission(contract, session, value, path);
  return {
    async createUpload(input) {
      permission(Permission.FilesWrite, 'ctx.files.createUpload');
      return api.createUpload(input);
    },
    async createSignedUploadUrl(input) {
      permission(Permission.FilesWrite, 'ctx.files.createSignedUploadUrl');
      return api.createSignedUploadUrl(input);
    },
    async completeUpload(id, input) {
      permission(Permission.FilesWrite, 'ctx.files.completeUpload');
      return api.completeUpload(id, input);
    },
    async read(id) {
      permission(Permission.FilesRead, 'ctx.files.read');
      return api.read(id);
    },
    async get(id) {
      permission(Permission.FilesRead, 'ctx.files.get');
      return api.get(id);
    },
    async list(query) {
      permission(Permission.FilesRead, 'ctx.files.list');
      return api.list(query);
    },
    async createSignedUrl(id, options) {
      permission(Permission.FilesRead, 'ctx.files.createSignedUrl');
      return api.createSignedUrl(id, options);
    },
    async createSignedDownloadUrl(id, options) {
      permission(Permission.FilesRead, 'ctx.files.createSignedDownloadUrl');
      return api.createSignedDownloadUrl(id, options);
    },
    async publish(id) {
      permission(Permission.FilesPublish, 'ctx.files.publish');
      return api.publish(id);
    },
    async unpublish(id) {
      permission(Permission.FilesPublish, 'ctx.files.unpublish');
      return api.unpublish(id);
    },
    async archive(id) {
      permission(Permission.FilesWrite, 'ctx.files.archive');
      return api.archive(id);
    },
    async delete(id) {
      permission(Permission.FilesWrite, 'ctx.files.delete');
      return api.delete(id);
    },
  };
}

function guardArtifacts(
  api: ModuleArtifactsApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleArtifactsApi {
  const permission = (value: PermissionValue, path: string) =>
    assertPermission(contract, session, value, path);
  return {
    async write(input) {
      permission(Permission.ArtifactsWrite, 'ctx.artifacts.write');
      return api.write(input);
    },
    async writeText(input) {
      permission(Permission.ArtifactsWrite, 'ctx.artifacts.writeText');
      return api.writeText(input);
    },
    async read(id) {
      permission(Permission.ArtifactsRead, 'ctx.artifacts.read');
      return api.read(id);
    },
    async readText(id) {
      permission(Permission.ArtifactsRead, 'ctx.artifacts.readText');
      return api.readText(id);
    },
    async updateMetadata(id, metadata) {
      permission(Permission.ArtifactsWrite, 'ctx.artifacts.updateMetadata');
      return api.updateMetadata(id, metadata);
    },
    async list(query) {
      permission(Permission.ArtifactsRead, 'ctx.artifacts.list');
      return api.list(query);
    },
    async tree(query) {
      permission(Permission.ArtifactsRead, 'ctx.artifacts.tree');
      return api.tree(query);
    },
    async delete(id) {
      permission(Permission.ArtifactsWrite, 'ctx.artifacts.delete');
      return api.delete(id);
    },
  };
}

function guardNotifications(
  api: ModuleNotificationsApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleNotificationsApi {
  return {
    async send(input) {
      assertPermission(contract, session, Permission.NotificationsSend, 'ctx.notifications.send');
      return api.send(input);
    },
    async list(query) {
      assertPermission(contract, session, Permission.NotificationsRead, 'ctx.notifications.list');
      return api.list(query);
    },
    async markRead(id) {
      assertPermission(
        contract,
        session,
        Permission.NotificationsRead,
        'ctx.notifications.markRead'
      );
      return api.markRead(id);
    },
  };
}

function guardRuns(
  api: ModuleRunsApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleRunsApi {
  const permission = (value: PermissionValue, path: string) =>
    assertPermission(contract, session, value, path);
  return {
    async create(input) {
      permission(Permission.RunsWrite, 'ctx.runs.create');
      return api.create(input);
    },
    async get(id) {
      permission(Permission.RunsRead, 'ctx.runs.get');
      return api.get(id);
    },
    async list(query) {
      permission(Permission.RunsRead, 'ctx.runs.list');
      return api.list(query);
    },
    async updateProgress(id, progress) {
      permission(Permission.RunsWrite, 'ctx.runs.updateProgress');
      return api.updateProgress(id, progress);
    },
    async appendLog(id, level, message, metadata) {
      permission(Permission.RunsWrite, 'ctx.runs.appendLog');
      return api.appendLog(id, level, message, metadata);
    },
    async succeed(id, result) {
      permission(Permission.RunsWrite, 'ctx.runs.succeed');
      return api.succeed(id, result);
    },
    async fail(id, error) {
      permission(Permission.RunsWrite, 'ctx.runs.fail');
      return api.fail(id, error);
    },
    async requestCancel(id) {
      permission(Permission.RunsWrite, 'ctx.runs.requestCancel');
      return api.requestCancel(id);
    },
    async cancel(id, reason) {
      permission(Permission.RunsWrite, 'ctx.runs.cancel');
      return api.cancel(id, reason);
    },
  };
}

function guardJobs(
  api: ModuleJobsApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleJobsApi {
  return {
    async list() {
      assertPermission(contract, session, Permission.JobsRegister, 'ctx.jobs.list');
      return api.list();
    },
    async run(name, input, options) {
      assertPermission(contract, session, Permission.JobsEnqueue, 'ctx.jobs.run');
      return api.run(name, input, options);
    },
  };
}

function guardEvents(
  api: ModuleEventsApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleEventsApi {
  return {
    async publish(name, payload, options) {
      assertPermission(contract, session, Permission.EventsEmit, 'ctx.events.publish');
      return api.publish(name, payload, options);
    },
  };
}

function guardWebhooks(
  api: ModuleWebhooksApi,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): ModuleWebhooksApi {
  return {
    async list() {
      assertPermission(contract, session, Permission.WebhookReceive, 'ctx.webhooks.list');
      return api.list();
    },
    async getReceipt(id) {
      assertPermission(contract, session, Permission.WebhookReceive, 'ctx.webhooks.getReceipt');
      return api.getReceipt(id);
    },
  };
}

function guardCommercialApis(input: {
  context: ModuleContext;
  contract: ModuleRuntimeContract;
  session: ModuleRuntimeAccessSession;
}): Pick<
  ModuleContext,
  | 'usage'
  | 'metering'
  | 'credits'
  | 'billing'
  | 'entitlements'
  | 'commerce'
  | 'redeemCodes'
  | 'risk'
> {
  const { context, contract, session } = input;

  async function assertEntitlementIdAccess(id: string, capabilityPath: string) {
    const grant = (await context.entitlements.list()).find((item) => item.id === id);
    if (grant) {
      assertSubjectAccess(session, grant.subject, capabilityPath);
      return;
    }
    if (!session.system && session.user?.role !== 'admin') {
      deny(
        'MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED',
        `${capabilityPath} cannot resolve commercial subject for entitlement "${id}".`
      );
    }
  }

  async function assertCreditReservationAccess(reservationId: string, capabilityPath: string) {
    const reservationEntry = (await context.credits.listLedger()).find(
      (entry) => entry.reservationId === reservationId
    );
    if (reservationEntry) {
      assertSubjectAccess(session, reservationEntry.subject, capabilityPath);
      return;
    }
    if (!session.system && session.user?.role !== 'admin') {
      deny(
        'MODULE_CAPABILITY_SUBJECT_SCOPE_DENIED',
        `${capabilityPath} cannot resolve commercial subject for reservation "${reservationId}".`
      );
    }
  }

  async function assertCreditSourceAccess(
    source: string,
    sourceId: string,
    capabilityPath: string
  ) {
    const entries = await context.credits.listLedger({ source, sourceId });
    for (const entry of entries) {
      assertSubjectAccess(session, entry.subject, capabilityPath);
    }
  }

  return {
    usage: {
      async record(recordInput) {
        assertPermission(contract, session, Permission.UsageWrite, 'ctx.usage.record');
        return context.usage.record(recordInput);
      },
      async increment(recordInput) {
        assertPermission(contract, session, Permission.UsageWrite, 'ctx.usage.increment');
        return context.usage.increment(recordInput);
      },
    } satisfies ModuleUsageApi,
    metering: {
      async authorize(meterInput) {
        assertPermission(contract, session, Permission.MeteringWrite, 'ctx.metering.authorize');
        return context.metering.authorize(meterInput);
      },
      async commit(id) {
        assertPermission(contract, session, Permission.MeteringWrite, 'ctx.metering.commit');
        return context.metering.commit(id);
      },
      async refund(id) {
        assertPermission(contract, session, Permission.MeteringWrite, 'ctx.metering.refund');
        return context.metering.refund(id);
      },
      async void(id) {
        assertPermission(contract, session, Permission.MeteringWrite, 'ctx.metering.void');
        return context.metering.void(id);
      },
      async reconcile() {
        assertPermission(contract, session, Permission.MeteringWrite, 'ctx.metering.reconcile');
        return context.metering.reconcile();
      },
      async charge(chargeInput) {
        assertPermission(contract, session, Permission.MeteringWrite, 'ctx.metering.charge');
        assertSubjectAccess(session, chargeInput.subject, 'ctx.metering.charge');
        return context.metering.charge(chargeInput);
      },
    } satisfies ModuleMeteringApi,
    credits: {
      async balance(
        balanceInput: string | { subject: CommercialSubject; unit?: string },
        unit?: string
      ) {
        assertPermission(contract, session, Permission.CreditsRead, 'ctx.credits.balance');
        const subject =
          typeof balanceInput === 'string'
            ? userCommercialSubject(balanceInput)
            : balanceInput.subject;
        assertSubjectAccess(session, subject, 'ctx.credits.balance');
        return typeof balanceInput === 'string'
          ? context.credits.balance(balanceInput, unit)
          : context.credits.balance(balanceInput);
      },
      async grant(creditInput) {
        assertPermission(contract, session, Permission.CreditsWrite, 'ctx.credits.grant');
        assertSubjectAccess(
          session,
          subjectFromInput(creditInput, 'ctx.credits.grant'),
          'ctx.credits.grant'
        );
        return context.credits.grant(creditInput);
      },
      async consume(creditInput) {
        assertPermission(contract, session, Permission.CreditsConsume, 'ctx.credits.consume');
        assertSubjectAccess(
          session,
          subjectFromInput(creditInput, 'ctx.credits.consume'),
          'ctx.credits.consume'
        );
        return context.credits.consume(creditInput);
      },
      async adjust(creditInput) {
        assertPermission(contract, session, Permission.CreditsWrite, 'ctx.credits.adjust');
        assertSubjectAccess(
          session,
          subjectFromInput(creditInput, 'ctx.credits.adjust'),
          'ctx.credits.adjust'
        );
        return context.credits.adjust(creditInput);
      },
      async refund(creditInput) {
        assertPermission(contract, session, Permission.CreditsWrite, 'ctx.credits.refund');
        assertSubjectAccess(
          session,
          subjectFromInput(creditInput, 'ctx.credits.refund'),
          'ctx.credits.refund'
        );
        return context.credits.refund(creditInput);
      },
      async reserve(creditInput) {
        assertPermission(contract, session, Permission.CreditsConsume, 'ctx.credits.reserve');
        assertSubjectAccess(
          session,
          subjectFromInput(creditInput, 'ctx.credits.reserve'),
          'ctx.credits.reserve'
        );
        return context.credits.reserve(creditInput);
      },
      async commitReservation(reservationInput) {
        assertPermission(
          contract,
          session,
          Permission.CreditsConsume,
          'ctx.credits.commitReservation'
        );
        await assertCreditReservationAccess(
          reservationInput.reservationId,
          'ctx.credits.commitReservation'
        );
        return context.credits.commitReservation(reservationInput);
      },
      async releaseReservation(reservationInput) {
        assertPermission(
          contract,
          session,
          Permission.CreditsConsume,
          'ctx.credits.releaseReservation'
        );
        await assertCreditReservationAccess(
          reservationInput.reservationId,
          'ctx.credits.releaseReservation'
        );
        return context.credits.releaseReservation(reservationInput);
      },
      async revokeBySource(revokeInput) {
        assertPermission(contract, session, Permission.CreditsWrite, 'ctx.credits.revokeBySource');
        await assertCreditSourceAccess(
          revokeInput.source,
          revokeInput.sourceId,
          'ctx.credits.revokeBySource'
        );
        return context.credits.revokeBySource(revokeInput);
      },
      async listLedger(ledgerInput) {
        assertPermission(contract, session, Permission.CreditsRead, 'ctx.credits.listLedger');
        const requestedSubject = ledgerInput
          ? subjectFromInput(
              { subject: ledgerInput.subject, userId: ledgerInput.userId },
              'ctx.credits.listLedger'
            )
          : undefined;
        assertOptionalSubjectAccess(session, requestedSubject, 'ctx.credits.listLedger');
        const entries = await context.credits.listLedger(ledgerInput);
        return filterAccessibleSubjects(session, entries, (entry) => entry.subject);
      },
    } satisfies ModuleCreditsApi,
    billing: {
      async getPlan(userId) {
        assertPermission(contract, session, Permission.BillingRead, 'ctx.billing.getPlan');
        assertOwnUser(session, userId, 'ctx.billing.getPlan');
        return context.billing.getPlan(userId);
      },
      async getCurrentPlan(userId) {
        assertPermission(contract, session, Permission.BillingRead, 'ctx.billing.getCurrentPlan');
        assertOwnUser(session, userId, 'ctx.billing.getCurrentPlan');
        return context.billing.getCurrentPlan(userId);
      },
      async hasEntitlement(userId, entitlement) {
        assertPermission(contract, session, Permission.BillingRead, 'ctx.billing.hasEntitlement');
        assertOwnUser(session, userId, 'ctx.billing.hasEntitlement');
        return context.billing.hasEntitlement(userId, entitlement);
      },
      async redeemCode(code, userId) {
        assertPermission(contract, session, Permission.BillingWrite, 'ctx.billing.redeemCode');
        assertOwnUser(session, userId, 'ctx.billing.redeemCode');
        return context.billing.redeemCode(code, userId);
      },
    } satisfies ModuleBillingApi,
    entitlements: {
      async has(
        hasInput: string | { subject: CommercialSubject; entitlement: string },
        entitlement?: string
      ) {
        assertPermission(contract, session, Permission.EntitlementsRead, 'ctx.entitlements.has');
        const subject =
          typeof hasInput === 'string' ? userCommercialSubject(hasInput) : hasInput.subject;
        assertSubjectAccess(session, subject, 'ctx.entitlements.has');
        return typeof hasInput === 'string'
          ? context.entitlements.has(hasInput, entitlement ?? '')
          : context.entitlements.has(hasInput);
      },
      async list(listInput) {
        assertPermission(contract, session, Permission.EntitlementsRead, 'ctx.entitlements.list');
        const requestedSubject = listInput
          ? subjectFromInput(
              { subject: listInput.subject, userId: listInput.userId },
              'ctx.entitlements.list'
            )
          : undefined;
        assertOptionalSubjectAccess(session, requestedSubject, 'ctx.entitlements.list');
        const grants = await context.entitlements.list(listInput);
        return filterAccessibleSubjects(session, grants, (grant) => grant.subject);
      },
      async grant(grantInput) {
        assertPermission(contract, session, Permission.EntitlementsWrite, 'ctx.entitlements.grant');
        assertSubjectAccess(
          session,
          subjectFromInput(grantInput, 'ctx.entitlements.grant'),
          'ctx.entitlements.grant'
        );
        return context.entitlements.grant(grantInput);
      },
      async revoke(revokeInput) {
        assertPermission(
          contract,
          session,
          Permission.EntitlementsWrite,
          'ctx.entitlements.revoke'
        );
        await assertEntitlementIdAccess(revokeInput.id, 'ctx.entitlements.revoke');
        return context.entitlements.revoke(revokeInput);
      },
      async override(overrideInput) {
        assertPermission(
          contract,
          session,
          Permission.EntitlementsWrite,
          'ctx.entitlements.override'
        );
        await assertEntitlementIdAccess(overrideInput.id, 'ctx.entitlements.override');
        return context.entitlements.override(overrideInput);
      },
      async expire(expireInput) {
        assertPermission(
          contract,
          session,
          Permission.EntitlementsWrite,
          'ctx.entitlements.expire'
        );
        assertPrivilegedCommercialMaintenance(session, 'ctx.entitlements.expire');
        return context.entitlements.expire(expireInput);
      },
    } satisfies ModuleEntitlementsApi,
    commerce: {
      async createCheckout(checkoutInput) {
        assertPermission(
          contract,
          session,
          Permission.CommerceWrite,
          'ctx.commerce.createCheckout'
        );
        const targetSubject =
          checkoutInput.beneficiary ??
          checkoutInput.buyer ??
          subjectFromInput({ userId: checkoutInput.userId }, 'ctx.commerce.createCheckout');
        assertSubjectAccess(session, targetSubject, 'ctx.commerce.createCheckout');
        return context.commerce.createCheckout(checkoutInput);
      },
      async getOrder(id) {
        assertPermission(contract, session, Permission.CommerceRead, 'ctx.commerce.getOrder');
        const order = await context.commerce.getOrder(id);
        if (order) {
          const targetSubject =
            order.beneficiary ??
            order.buyer ??
            (order.userId ? userCommercialSubject(order.userId) : undefined);
          assertOptionalSubjectAccess(session, targetSubject, 'ctx.commerce.getOrder');
        }
        return order;
      },
      async applyCheckoutPaid(paidInput) {
        assertPermission(
          contract,
          session,
          Permission.CommerceApply,
          'ctx.commerce.applyCheckoutPaid'
        );
        return context.commerce.applyCheckoutPaid(paidInput);
      },
      async applyRefund(refundInput) {
        assertPermission(contract, session, Permission.CommerceApply, 'ctx.commerce.applyRefund');
        return context.commerce.applyRefund(refundInput);
      },
      async recordSubscriptionEvent(eventInput) {
        assertPermission(
          contract,
          session,
          Permission.CommerceApply,
          'ctx.commerce.recordSubscriptionEvent'
        );
        return context.commerce.recordSubscriptionEvent(eventInput);
      },
      async reconcilePaidOrderBenefits(reconcileInput) {
        assertPermission(
          contract,
          session,
          Permission.CommerceApply,
          'ctx.commerce.reconcilePaidOrderBenefits'
        );
        return context.commerce.reconcilePaidOrderBenefits(reconcileInput);
      },
    } satisfies ModuleCommerceApi,
    redeemCodes: {
      async createBatch(batchInput) {
        assertPermission(
          contract,
          session,
          Permission.RedeemCodesWrite,
          'ctx.redeemCodes.createBatch'
        );
        return context.redeemCodes.createBatch(batchInput);
      },
      async redeem(redeemInput) {
        assertPermission(contract, session, Permission.RedeemCodesRedeem, 'ctx.redeemCodes.redeem');
        assertSubjectAccess(
          session,
          subjectFromInput(redeemInput, 'ctx.redeemCodes.redeem'),
          'ctx.redeemCodes.redeem'
        );
        return context.redeemCodes.redeem(redeemInput);
      },
      async freeze(freezeInput) {
        assertPermission(contract, session, Permission.RedeemCodesWrite, 'ctx.redeemCodes.freeze');
        return context.redeemCodes.freeze(freezeInput);
      },
      async revoke(revokeInput) {
        assertPermission(contract, session, Permission.RedeemCodesWrite, 'ctx.redeemCodes.revoke');
        return context.redeemCodes.revoke(revokeInput);
      },
      async list(listInput) {
        assertPermission(contract, session, Permission.RedeemCodesRead, 'ctx.redeemCodes.list');
        return context.redeemCodes.list(listInput);
      },
      async listRedemptions(redemptionInput) {
        assertPermission(
          contract,
          session,
          Permission.RedeemCodesRead,
          'ctx.redeemCodes.listRedemptions'
        );
        const requestedSubject = redemptionInput
          ? subjectFromInput(
              { subject: redemptionInput.subject, userId: redemptionInput.userId },
              'ctx.redeemCodes.listRedemptions'
            )
          : undefined;
        assertOptionalSubjectAccess(session, requestedSubject, 'ctx.redeemCodes.listRedemptions');
        const redemptions = await context.redeemCodes.listRedemptions(redemptionInput);
        return filterAccessibleSubjects(session, redemptions, (redemption) => redemption.subject);
      },
    } satisfies ModuleRedeemCodesApi,
    risk: {
      async record(riskInput) {
        assertPermission(contract, session, Permission.RiskWrite, 'ctx.risk.record');
        assertOptionalSubjectAccess(session, riskInput.subject, 'ctx.risk.record');
        return context.risk.record(riskInput);
      },
      async block(blockInput) {
        assertPermission(contract, session, Permission.RiskWrite, 'ctx.risk.block');
        assertSubjectAccess(session, blockInput.subject, 'ctx.risk.block');
        return context.risk.block(blockInput);
      },
      async check(checkInput) {
        assertPermission(contract, session, Permission.RiskRead, 'ctx.risk.check');
        assertOptionalSubjectAccess(session, checkInput.subject, 'ctx.risk.check');
        return context.risk.check(checkInput);
      },
    } satisfies ModuleRiskApi,
  };
}

export function guardModuleContextCapabilities(
  input: GuardModuleContextCapabilitiesInput
): ModuleContext {
  const { context, contract, session } = input;
  return {
    ...context,
    data: guardData(context.data, contract, session),
    config: guardConfig(context.config, contract, session),
    secrets: guardSecrets(context.secrets, contract, session),
    services: guardServices(context.services, contract, session),
    connectors: guardConnectors(context.connectors, contract, session),
    resourceBindings: guardResourceBindings(context.resourceBindings, contract, session),
    http: guardHttp(context.http, contract, session),
    files: guardFiles(context.files, contract, session),
    artifacts: guardArtifacts(context.artifacts, contract, session),
    notifications: guardNotifications(context.notifications, contract, session),
    runs: guardRuns(context.runs, contract, session),
    jobs: guardJobs(context.jobs, contract, session),
    events: guardEvents(context.events, contract, session),
    webhooks: guardWebhooks(context.webhooks, contract, session),
    ai: {
      async generateText(aiInput) {
        assertPermission(contract, session, Permission.AiGenerate, 'ctx.ai.generateText');
        return context.ai.generateText(aiInput);
      },
      async *streamText(aiInput) {
        assertPermission(contract, session, Permission.AiGenerate, 'ctx.ai.streamText');
        yield* context.ai.streamText(aiInput);
      },
      async embedText(aiInput) {
        assertPermission(contract, session, Permission.AiEmbed, 'ctx.ai.embedText');
        return context.ai.embedText(aiInput);
      },
    } satisfies ModuleAiApi,
    rag: {
      async index(ragInput) {
        assertPermission(contract, session, Permission.RagWrite, 'ctx.rag.index');
        return context.rag.index(ragInput);
      },
      async search(ragInput) {
        assertPermission(contract, session, Permission.RagRead, 'ctx.rag.search');
        return context.rag.search(ragInput);
      },
      async contextPack(ragInput) {
        assertPermission(contract, session, Permission.RagRead, 'ctx.rag.contextPack');
        return context.rag.contextPack(ragInput);
      },
      async buildContextPack(ragInput) {
        assertPermission(contract, session, Permission.RagRead, 'ctx.rag.buildContextPack');
        return context.rag.buildContextPack(ragInput);
      },
      async delete(id) {
        assertPermission(contract, session, Permission.RagWrite, 'ctx.rag.delete');
        return context.rag.delete(id);
      },
    } satisfies ModuleRagApi,
    apiKeys: {
      async create(createInput) {
        assertPermission(contract, session, Permission.ApiKeysWrite, 'ctx.apiKeys.create');
        assertOptionalSubjectAccess(session, createInput.owner, 'ctx.apiKeys.create');
        return context.apiKeys.create(createInput);
      },
      async rotate(rotateInput) {
        assertPermission(contract, session, Permission.ApiKeysWrite, 'ctx.apiKeys.rotate');
        return context.apiKeys.rotate(rotateInput);
      },
      async revoke(revokeInput) {
        assertPermission(contract, session, Permission.ApiKeysWrite, 'ctx.apiKeys.revoke');
        return context.apiKeys.revoke(revokeInput);
      },
      async list(listInput) {
        assertPermission(contract, session, Permission.ApiKeysRead, 'ctx.apiKeys.list');
        assertOptionalSubjectAccess(session, listInput?.owner, 'ctx.apiKeys.list');
        const keys = await context.apiKeys.list(listInput);
        return filterAccessibleSubjects(session, keys, (key) => key.owner);
      },
      async verify(apiKey) {
        assertPermission(contract, session, Permission.ApiKeysRead, 'ctx.apiKeys.verify');
        return context.apiKeys.verify(apiKey);
      },
      async require(apiKey) {
        assertPermission(contract, session, Permission.ApiKeysRead, 'ctx.apiKeys.require');
        return context.apiKeys.require(apiKey);
      },
    } satisfies ModuleApiKeysApi,
    rateLimit: {
      async check(rateInput) {
        assertPermission(contract, session, Permission.RateLimitCheck, 'ctx.rateLimit.check');
        return context.rateLimit.check(rateInput);
      },
    } satisfies ModuleRateLimitApi,
    cache: {
      async get(key) {
        assertPermission(contract, session, Permission.CacheRevalidate, 'ctx.cache.get');
        return context.cache.get(key);
      },
      async set(key, value, options) {
        assertPermission(contract, session, Permission.CacheRevalidate, 'ctx.cache.set');
        return context.cache.set(key, value, options);
      },
      async delete(key) {
        assertPermission(contract, session, Permission.CacheRevalidate, 'ctx.cache.delete');
        return context.cache.delete(key);
      },
      async remember(key, factory, options) {
        assertPermission(contract, session, Permission.CacheRevalidate, 'ctx.cache.remember');
        return context.cache.remember(key, factory, options);
      },
    } satisfies ModuleCacheApi,
    audit: {
      async record(type, metadata) {
        assertPermission(contract, session, Permission.AuditWrite, 'ctx.audit.record');
        return context.audit.record(type, metadata);
      },
    } satisfies ModuleAuditApi,
    ...guardCommercialApis({ context, contract, session }),
  };
}
