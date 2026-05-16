'use client';

import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  status?: string;
}

export interface TaskTypeSummary {
  id: string;
  task_key: string;
  name: string;
  status: string;
}

export interface WorkerContractSummary {
  contract_version: string;
  project_id: string;
  task_type_id: string;
  task_key: string;
  name: string;
  description?: string;
  input_schema: unknown;
  output_schema: unknown;
  required_worker_tags: readonly string[];
  lease_sec: number;
  timeout_sec: number;
  max_retry: number;
  worker_protocol: Record<string, string>;
  starter_defaults: Record<string, unknown>;
  mock_input: unknown;
}

export interface ValidatorSummary {
  job: { id: string; status: string; progress?: number };
  state: string;
  checks: Array<{ key: string; label: string; passed: boolean }>;
  events: Array<{ id: string; event_type: string; created_at?: string }>;
  logs: Array<{ id: string; level: string; message: string; created_at?: string }>;
}

export function pluginApiPath(pluginId: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `/api/plugins/${pluginId}${normalized}`;
}

export function pluginPagePath(props: PluginRuntimePageProps, localPath: string): string {
  const normalizedLocal = localPath.startsWith('/') ? localPath : `/${localPath}`;
  const currentLocal = props.localPath === '/' ? '' : props.localPath;
  const base =
    currentLocal && props.requestPath.endsWith(currentLocal)
      ? props.requestPath.slice(0, -currentLocal.length)
      : props.requestPath.replace(/\/$/, '');
  return `${base}${normalizedLocal}`;
}

export async function requestJson<T>(
  pluginId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', headers.get('accept') ?? 'application/json');
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(pluginApiPath(pluginId, path), {
    ...init,
    headers,
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(errorMessage(body, response.status));
  }
  return body as T;
}

export function formatJSON(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export async function copyText(value: string): Promise<void> {
  if (!value) {
    return;
  }
  await navigator.clipboard.writeText(value);
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function statusTone(status?: string): string {
  const normalized = (status ?? '').toLowerCase();
  if (['active', 'succeeded', 'passed'].includes(normalized)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (['waiting', 'running', 'scheduled'].includes(normalized)) {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }
  if (['failed', 'cancelled', 'archived'].includes(normalized)) {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  return 'border-muted bg-muted/30 text-muted-foreground';
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === 'object') {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === 'string' && message) {
        return message;
      }
    }
    if (typeof record.message === 'string' && record.message) {
      return record.message;
    }
  }
  return `Request failed with HTTP ${status}.`;
}
