import { Permission, type ModuleContext, type PermissionValue } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeAccessSession } from './session';
import { assertPermission } from './capability-guard-common';

export interface GuardModuleContextCapabilitiesInput {
  context: ModuleContext;
  contract: ModuleRuntimeContract;
  session: ModuleRuntimeAccessSession;
}

function permissionFor(path: string): PermissionValue | undefined {
  if (path === 'data.transaction') return Permission.DataTransaction;
  if (path.startsWith('data.document.')) {
    return ['findMany', 'findOne', 'findById', 'count', 'exists'].includes(path.split('.').at(-1) ?? '')
      ? Permission.DataDocumentRead
      : Permission.DataDocumentWrite;
  }
  if (path.startsWith('data.table.')) {
    return ['findMany', 'findOne', 'findById', 'count', 'exists'].includes(path.split('.').at(-1) ?? '')
      ? Permission.DataTableRead
      : Permission.DataTableWrite;
  }
  if (path.startsWith('files.')) {
    return ['read', 'get', 'list', 'createSignedUrl', 'createSignedDownloadUrl'].includes(path.split('.').at(-1) ?? '')
      ? Permission.FilesRead
      : path.endsWith('.publish') || path.endsWith('.unpublish')
        ? Permission.FilesPublish
        : Permission.FilesWrite;
  }
  if (path.startsWith('runs.')) return path.endsWith('.get') || path.endsWith('.list') ? Permission.RunsRead : Permission.RunsWrite;
  if (path.startsWith('jobs.')) return path.endsWith('.list') ? Permission.RunsRead : Permission.JobsEnqueue;
  if (path.startsWith('events.')) return Permission.EventsEmit;
  if (path.startsWith('notifications.')) return path.endsWith('.send') ? Permission.NotificationsSend : Permission.NotificationsRead;
  if (path.startsWith('services.')) return Permission.ServicesInvoke;
  if (path.startsWith('ai.')) return path.endsWith('.embedText') ? Permission.AiEmbed : Permission.AiGenerate;
  if (path.startsWith('rag.')) return path.endsWith('.index') || path.endsWith('.delete') ? Permission.RagWrite : Permission.RagRead;
  if (path.startsWith('audit.')) return Permission.AuditWrite;
  if (path.startsWith('commercial.')) return path.endsWith('.read') ? Permission.CommercialRead : path.endsWith('.checkout') ? Permission.CommercialCheckout : Permission.CommercialCharge;
  return undefined;
}

function guardValue(
  value: unknown,
  path: string,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession,
  seen = new WeakMap<object, unknown>()
): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const existing = seen.get(value);
  if (existing) return existing;
  const proxy = new Proxy(value as Record<string, unknown>, {
    get(target, property, receiver) {
      const child = Reflect.get(target, property, receiver);
      const childPath = `${path}.${String(property)}`;
      if (typeof child === 'function') {
        return (...args: unknown[]) => {
          const permission = permissionFor(childPath);
          if (permission) assertPermission(contract, session, permission, `ctx.${childPath}`);
          return Reflect.apply(child, target, args);
        };
      }
      return guardValue(child, childPath, contract, session, seen);
    },
  });
  seen.set(value, proxy);
  return proxy;
}

export function guardModuleContextCapabilities(
  input: GuardModuleContextCapabilitiesInput
): ModuleContext {
  return guardValue(input.context, '', input.contract, input.session) as ModuleContext;
}
