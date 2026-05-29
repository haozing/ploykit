import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { ModuleHostSession } from '@/lib/module-runtime';
import { findAdminPageRegistryEntry } from './admin-route-registry';
import { requireAdminUser, requireHostUser } from './auth';
import {
  HOST_PATHNAME_HEADER,
  languageFromRequest,
  languageFromHeaders,
  localizedPath,
  type SupportedLanguage,
} from './i18n';
import { getHostCapabilitiesForSession, requireCapability, type HostCapability } from './rbac';

export interface HostRequestContext {
  lang: SupportedLanguage;
  productId: string | null;
  workspaceId: string | null;
  actorId: string | null;
  userId: string | null;
  capabilities: readonly HostCapability[];
  correlationId: string;
  requestPath: string;
  session: ModuleHostSession;
}

export function createHostRequestContext(input: {
  lang: SupportedLanguage;
  requestPath: string;
  session: ModuleHostSession;
  correlationId?: string;
}): HostRequestContext {
  const session = input.session;
  return {
    lang: input.lang,
    productId: session.productId ?? null,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.userId ?? session.user?.id ?? null,
    userId: session.userId ?? session.user?.id ?? null,
    capabilities: getHostCapabilitiesForSession(session),
    correlationId: input.correlationId ?? randomUUID(),
    requestPath: input.requestPath,
    session,
  };
}

export async function readCurrentRequestLanguage(): Promise<SupportedLanguage> {
  return languageFromHeaders(await headers());
}

export async function requireAdminActionContext(path: string): Promise<HostRequestContext> {
  const requestHeaders = await headers();
  const lang = languageFromHeaders(requestHeaders);
  const requestPath = localizedPath(lang, path);
  const session = await requireAdminUser(lang, requestPath);
  const registryEntry = findAdminPageRegistryEntry(path);
  if (!registryEntry) {
    throw new Error(`ADMIN_PAGE_REGISTRY_ENTRY_MISSING:${path}`);
  }
  requireCapability(session, registryEntry.capability);
  return createHostRequestContext({
    lang,
    requestPath: requestHeaders.get(HOST_PATHNAME_HEADER) ?? requestPath,
    session,
  });
}

export async function requireUserActionContext(path: string): Promise<HostRequestContext> {
  const requestHeaders = await headers();
  const lang = languageFromHeaders(requestHeaders);
  const requestPath = localizedPath(lang, path);
  const session = await requireHostUser(lang, requestPath);
  return createHostRequestContext({
    lang,
    requestPath: requestHeaders.get(HOST_PATHNAME_HEADER) ?? requestPath,
    session,
  });
}

export async function requireAdminRequestContext(
  request: Request,
  path: string
): Promise<HostRequestContext> {
  const lang = languageFromRequest(request);
  const requestPath = localizedPath(lang, path);
  const session = await requireAdminUser(lang, requestPath);
  const registryEntry = findAdminPageRegistryEntry(path);
  if (!registryEntry) {
    throw new Error(`ADMIN_PAGE_REGISTRY_ENTRY_MISSING:${path}`);
  }
  requireCapability(session, registryEntry.capability);
  return createHostRequestContext({
    lang,
    requestPath,
    session,
  });
}

export async function requireUserRequestContext(
  request: Request,
  path: string
): Promise<HostRequestContext> {
  const lang = languageFromRequest(request);
  const requestPath = localizedPath(lang, path);
  const session = await requireHostUser(lang, requestPath);
  return createHostRequestContext({
    lang,
    requestPath,
    session,
  });
}

export function revalidateLocalizedPaths(
  lang: SupportedLanguage,
  paths: readonly string[]
): void {
  for (const path of paths) {
    revalidatePath(localizedPath(lang, path));
  }
}

export function sessionFromContext(context: HostRequestContext): ModuleHostSession {
  return context.session;
}
