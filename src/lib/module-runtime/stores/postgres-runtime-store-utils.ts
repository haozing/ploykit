import { randomUUID } from 'node:crypto';

export function createDefaultId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function json(value: unknown): unknown {
  return value === undefined ? null : JSON.stringify(value);
}

export function toIso(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export function runtimeWorkspaceKey(workspaceId?: string | null): string {
  return workspaceId ?? '';
}

export function runtimeWorkspaceFilter(workspaceId?: string | null): string | null {
  return workspaceId === undefined ? null : runtimeWorkspaceKey(workspaceId);
}

export function creditWorkspaceKey(workspaceId?: string | null): string {
  return runtimeWorkspaceKey(workspaceId);
}

export function creditWorkspaceFilter(workspaceId?: string | null): string | null {
  return runtimeWorkspaceFilter(workspaceId);
}

export function orderWorkspaceKey(workspaceId?: string | null): string {
  return runtimeWorkspaceKey(workspaceId);
}

export function orderWorkspaceFilter(workspaceId?: string | null): string | null {
  return runtimeWorkspaceFilter(workspaceId);
}

export function errorFrom(error?: Error | string): { code: string; message: string } | undefined {
  if (!error) {
    return undefined;
  }
  return typeof error === 'string'
    ? { code: 'RUNTIME_STORE_ERROR', message: error }
    : { code: error.name || 'RUNTIME_STORE_ERROR', message: error.message };
}

export function deliveryErrorFrom(
  error?: Error | string | { code: string; message: string }
): { code: string; message: string } | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'object' && 'code' in error && 'message' in error) {
    return error;
  }
  return errorFrom(error);
}
