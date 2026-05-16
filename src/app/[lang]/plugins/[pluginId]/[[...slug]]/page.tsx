import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PluginError } from '@ploykit/plugin-sdk';
import {
  createPluginCommercialRedirectPath,
  isPluginCommercialError,
  resolvePluginPageRuntime,
} from '@/lib/plugin-runtime';
import { PluginRuntimePageRenderer } from '@/components/plugins/plugin-runtime-page-renderer';
import { ShellLayout } from '@/components/layouts/ShellLayout';
import { DashboardLayoutWrapper } from '@/components/layouts/DashboardLayoutWrapper';
import { logger } from '@/lib/_core/logger';
import { IntlMessagesProvider } from '@/i18n/IntlMessagesProvider';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{
    lang: string;
    pluginId: string;
    slug?: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PluginPage({ params, searchParams }: Props) {
  const { lang, pluginId, slug = [] } = await params;
  const query = await searchParams;
  const requestHeaders = await headers();
  const runtimeResult = await resolveRuntimePageOrNotFound(
    pluginId,
    slug,
    requestHeaders,
    lang,
    query
  );
  const pluginContent = <PluginRuntimePageRenderer result={runtimeResult} />;

  if (runtimeResult.route.layout === 'site') {
    return (
      <IntlMessagesProvider scope="site">
        <ShellLayout pathname={runtimeResult.requestPath} locale={lang}>
          {pluginContent}
        </ShellLayout>
      </IntlMessagesProvider>
    );
  }

  if (runtimeResult.route.layout === 'dashboard') {
    return <DashboardLayoutWrapper>{pluginContent}</DashboardLayoutWrapper>;
  }

  logger.error(
    {
      pluginId,
      requestPath: runtimeResult.requestPath,
      layout: runtimeResult.route.layout,
    },
    'Admin plugin runtime routes must use /admin/plugins'
  );
  notFound();
}

async function resolveRuntimePageOrNotFound(
  pluginId: string,
  slug: string[],
  requestHeaders: Headers,
  lang: string,
  query?: Record<string, string | string[] | undefined>
) {
  try {
    return await resolvePluginPageRuntime(pluginId, slug, requestHeaders, { locale: lang, query });
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
    const callbackUrl = encodeURIComponent(createPluginPagePath(lang, pluginId, slug));
    redirect(`/${lang}/login?callbackUrl=${callbackUrl}`);
  }

  if (error instanceof PluginError && error.code === 'PLUGIN_ADMIN_REQUIRED') {
    redirect(`/${lang}/profile`);
  }

  if (isPluginCommercialError(error)) {
    const callbackPath = createPluginPagePath(lang, pluginId, slug);
    redirect(createPluginCommercialRedirectPath(lang, pluginId, callbackPath, error));
  }

  throw error;
}

function createPluginPagePath(lang: string, pluginId: string, slug: readonly string[]): string {
  return ['/', lang, 'plugins', pluginId, ...slug].join('/').replace(/\/+/g, '/');
}
