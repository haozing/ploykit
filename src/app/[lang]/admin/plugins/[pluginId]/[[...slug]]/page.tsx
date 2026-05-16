import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PluginError } from '@ploykit/plugin-sdk';
import {
  createPluginCommercialRedirectPath,
  isPluginCommercialError,
  resolveAdminPluginPageRuntime,
} from '@/lib/plugin-runtime';
import { PluginRuntimePageRenderer } from '@/components/plugins/plugin-runtime-page-renderer';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{
    lang: string;
    pluginId: string;
    slug?: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminPluginPage({ params, searchParams }: Props) {
  const { lang, pluginId, slug = [] } = await params;
  const query = await searchParams;
  const requestHeaders = await headers();
  const runtimeResult = await resolveAdminRuntimePageOrNotFound(
    pluginId,
    slug,
    requestHeaders,
    lang,
    query
  );

  return <PluginRuntimePageRenderer result={runtimeResult} />;
}

async function resolveAdminRuntimePageOrNotFound(
  pluginId: string,
  slug: string[],
  requestHeaders: Headers,
  lang: string,
  query?: Record<string, string | string[] | undefined>
) {
  try {
    return await resolveAdminPluginPageRuntime(pluginId, slug, requestHeaders, {
      locale: lang,
      query,
    });
  } catch (error) {
    handleRuntimePageResolutionError(error, lang, pluginId, slug);
  }
}

function handleRuntimePageResolutionError(
  error: unknown,
  lang: string,
  pluginId: string,
  slug: readonly string[]
): never {
  if (
    error instanceof PluginError &&
    ['PLUGIN_DISABLED', 'PLUGIN_RUNTIME_NOT_FOUND', 'PLUGIN_PAGE_ROUTE_NOT_FOUND'].includes(
      error.code
    )
  ) {
    notFound();
  }

  if (error instanceof PluginError && error.code === 'PLUGIN_AUTH_REQUIRED') {
    const callbackUrl = encodeURIComponent(createAdminPluginPagePath(lang, pluginId, slug));
    redirect(`/${lang}/login?callbackUrl=${callbackUrl}`);
  }

  if (error instanceof PluginError && error.code === 'PLUGIN_ADMIN_REQUIRED') {
    redirect(`/${lang}/profile`);
  }

  if (isPluginCommercialError(error)) {
    const callbackPath = createAdminPluginPagePath(lang, pluginId, slug);
    redirect(createPluginCommercialRedirectPath(lang, pluginId, callbackPath, error));
  }

  throw error;
}

function createAdminPluginPagePath(
  lang: string,
  pluginId: string,
  slug: readonly string[]
): string {
  return ['/', lang, 'admin', 'plugins', pluginId, ...slug].join('/').replace(/\/+/g, '/');
}
