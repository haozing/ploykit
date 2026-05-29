import type { ModuleRunRuntime } from '../runs';
import type { RuntimeAuditLog } from '../observability';

export interface ModuleAdminWebhookReceiptStore {
  list(query?: { moduleId?: string }): unknown[];
}

export interface ModuleAdminCommercialRuntime {
  listUsage(): unknown[];
  listMetering(): unknown[];
  listCheckouts(): unknown[];
}

export interface ModuleAdminRuntime {
  listRuns(query?: { moduleId?: string }): unknown[];
  listWebhookReceipts(query?: { moduleId?: string }): unknown[];
  listAuditLogs(query?: { moduleId?: string; type?: string }): unknown[];
  listUsage(): unknown[];
  listMetering(): unknown[];
  listCheckouts(): unknown[];
}

export interface CreateModuleAdminRuntimeOptions {
  runs?: ModuleRunRuntime;
  webhookReceipts?: ModuleAdminWebhookReceiptStore;
  audit?: RuntimeAuditLog;
  commercial?: ModuleAdminCommercialRuntime;
}

export function createModuleAdminRuntime(
  options: CreateModuleAdminRuntimeOptions = {}
): ModuleAdminRuntime {
  return {
    listRuns(query = {}) {
      return options.runs?.listRuns(query) ?? [];
    },
    listWebhookReceipts(query = {}) {
      return options.webhookReceipts?.list(query) ?? [];
    },
    listAuditLogs(query = {}) {
      return options.audit?.list(query) ?? [];
    },
    listUsage() {
      return options.commercial?.listUsage() ?? [];
    },
    listMetering() {
      return options.commercial?.listMetering() ?? [];
    },
    listCheckouts() {
      return options.commercial?.listCheckouts() ?? [];
    },
  };
}
