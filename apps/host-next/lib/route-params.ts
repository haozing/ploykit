import { notFound } from 'next/navigation';
import type { ModuleHostSession } from '@/lib/module-runtime';
import { findAdminPageRegistryEntry } from './admin-route-registry';
import { requireAdminUser, requireHostUser } from './auth';
import { isSupportedLanguage, localizedPath, type SupportedLanguage } from './i18n';
import { requireCapability } from './rbac';

export interface LanguageRouteParams {
  lang: string;
}

export async function readLanguageParam(
  params: Promise<LanguageRouteParams>
): Promise<SupportedLanguage> {
  const { lang } = await params;
  if (!isSupportedLanguage(lang)) {
    notFound();
  }

  return lang;
}

export async function readLanguageAndRequireUser(
  params: Promise<LanguageRouteParams>,
  path: string
): Promise<[SupportedLanguage, ModuleHostSession]> {
  const lang = await readLanguageParam(params);
  const session = await requireHostUser(lang, localizedPath(lang, path));
  return [lang, session];
}

export async function readLanguageAndRequireAdmin(
  params: Promise<LanguageRouteParams>,
  path: string
): Promise<[SupportedLanguage, ModuleHostSession]> {
  const lang = await readLanguageParam(params);
  const session = await requireAdminUser(lang, localizedPath(lang, path));
  const registryEntry = findAdminPageRegistryEntry(path);
  if (!registryEntry) {
    throw new Error(`ADMIN_PAGE_REGISTRY_ENTRY_MISSING:${path}`);
  }
  requireCapability(session, registryEntry.capability);
  return [lang, session];
}
