import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PluginError } from '@ploykit/plugin-sdk';
import {
  createPluginCommercialRedirectPath,
  isPluginCommercialError,
  resolvePluginPageRuntime,
  resolvePluginRouteMetadata,
  resolvePluginToolRoute,
} from '@/lib/plugin-runtime';
import { PluginRuntimePageRenderer } from '@/components/plugins/plugin-runtime-page-renderer';
import { ShellLayout } from '@/components/layouts/ShellLayout';
import type { RuntimePageRoute } from '@/lib/plugin-runtime';
import { IntlMessagesProvider } from '@/i18n/IntlMessagesProvider';

export const revalidate = 300;

interface Props {
  params: Promise<{
    lang: string;
    slug?: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function localToolPath(slug: readonly string[]): string {
  return ['tools', ...slug].join('/').replace(/\/+/g, '/');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug = [] } = await params;
  const match = await resolvePluginToolRoute(`/${localToolPath(slug)}`);

  if (!match) {
    return {};
  }

  const route = match.contract.routes.pages.find((candidate) => candidate.path === match.localPath);
  if (!route) {
    return {};
  }

  const requestHeaders = needsRequestHeaders(route) ? await headers() : new Headers();
  const resolved = await resolvePluginRouteMetadata({
    pluginId: match.pluginId,
    contract: match.contract,
    route,
    entry: match.entry,
    localPath: match.localPath,
    requestPath: `/${localToolPath(slug)}`,
    locale: lang,
    pathname: `/${lang}/${localToolPath(slug)}`,
    requestHeaders,
  });
  return resolved.metadata;
}

export default async function PluginToolPage({ params, searchParams }: Props) {
  const { lang, slug = [] } = await params;
  const query = await searchParams;
  const match = await resolvePluginToolRoute(`/${localToolPath(slug)}`);

  if (!match) {
    notFound();
  }

  const route = match.contract.routes.pages.find((candidate) => candidate.path === match.localPath);
  const requestHeaders = needsRequestHeaders(route) ? await headers() : new Headers();
  const runtimeResult = await resolveToolRuntimePageOrNotFound(
    match.pluginId,
    match.slug,
    requestHeaders,
    lang,
    slug,
    match.entry,
    query
  );
  const metadata = await resolvePluginRouteMetadata({
    pluginId: match.pluginId,
    contract: match.contract,
    route: runtimeResult.route,
    entry: match.entry,
    localPath: runtimeResult.localPath,
    requestPath: runtimeResult.requestPath,
    params: runtimeResult.params,
    query: runtimeResult.query,
    locale: lang,
    pathname: `/${lang}/${localToolPath(slug)}`,
    requestHeaders,
    data: runtimeResult.data,
  });

  return (
    <IntlMessagesProvider scope="site">
      <ShellLayout pathname={`/${localToolPath(slug)}`} locale={lang}>
        {metadata.structuredDataScripts.map((script) => (
          <script
            key={script.id}
            id={script.id}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: script.json }}
          />
        ))}
        <PluginRuntimePageRenderer result={runtimeResult} />
      </ShellLayout>
    </IntlMessagesProvider>
  );
}

function needsRequestHeaders(route: RuntimePageRoute | undefined): boolean {
  return !route || route.auth !== 'public' || route.layout !== 'site' || Boolean(route.commercial);
}

async function resolveToolRuntimePageOrNotFound(
  pluginId: string,
  slug: string[],
  requestHeaders: Headers,
  lang: string,
  publicSlug: readonly string[],
  entry: NonNullable<Awaited<ReturnType<typeof resolvePluginToolRoute>>>['entry'],
  query?: Record<string, string | string[] | undefined>
) {
  try {
    return await resolvePluginPageRuntime(pluginId, slug, requestHeaders, {
      entry: entry ?? undefined,
      locale: lang,
      publicPathPrefix: 'tools',
      query,
    });
  } catch (error) {
    handleToolRuntimePageResolutionError(error, lang, pluginId, publicSlug);
  }
}

function handleToolRuntimePageResolutionError(
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
    const callbackUrl = encodeURIComponent(createToolPagePath(lang, slug));
    redirect(`/${lang}/login?callbackUrl=${callbackUrl}`);
  }

  if (error instanceof PluginError && error.code === 'PLUGIN_ADMIN_REQUIRED') {
    redirect(`/${lang}/profile`);
  }

  if (isPluginCommercialError(error)) {
    const callbackPath = createToolPagePath(lang, slug);
    redirect(createPluginCommercialRedirectPath(lang, pluginId, callbackPath, error));
  }

  throw error;
}

function createToolPagePath(lang: string, slug: readonly string[]): string {
  return ['/', lang, 'tools', ...slug].join('/').replace(/\/+/g, '/');
}
