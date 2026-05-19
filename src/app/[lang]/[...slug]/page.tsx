import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PluginError } from '@ploykit/plugin-sdk';
import {
  createPluginCommercialRedirectPath,
  isPluginCommercialError,
  resolvePluginPageRuntime,
  resolvePluginRouteMetadata,
  resolvePluginPublicRouteAlias,
} from '@/lib/plugin-runtime';
import { PluginRuntimePageRenderer } from '@/components/plugins/plugin-runtime-page-renderer';
import { ShellLayout } from '@/components/layouts/ShellLayout';
import { IntlMessagesProvider } from '@/i18n/IntlMessagesProvider';

export const revalidate = 300;

interface Props {
  params: Promise<{
    lang: string;
    slug?: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function publicPath(slug: readonly string[]): string {
  return ['/', ...slug].join('/').replace(/\/+/g, '/');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug = [] } = await params;
  const path = publicPath(slug);
  const match = await resolvePluginPublicRouteAlias(path);

  if (!match) {
    return {};
  }

  const requestHeaders =
    match.route.auth === 'public' && !match.route.commercial ? new Headers() : await headers();
  const resolved = await resolvePluginRouteMetadata({
    pluginId: match.pluginId,
    contract: match.contract,
    route: match.route,
    entry: match.entry,
    localPath: match.route.path,
    requestPath: match.requestPath,
    params: match.params,
    locale: lang,
    pathname: `/${lang}${path === '/' ? '' : path}`,
    requestHeaders,
  });
  return resolved.metadata;
}

export default async function PluginPublicAliasPage({ params, searchParams }: Props) {
  const { lang, slug = [] } = await params;
  const query = await searchParams;
  const match = await resolvePluginPublicRouteAlias(publicPath(slug));

  if (!match) {
    notFound();
  }

  const requestHeaders =
    match.route.auth === 'public' && !match.route.commercial ? new Headers() : await headers();
  const runtimeResult = await resolveAliasRuntimePageOrNotFound(match, requestHeaders, lang, query);
  const metadata = await resolvePluginRouteMetadata({
    pluginId: match.pluginId,
    contract: match.contract,
    route: match.route,
    entry: match.entry,
    localPath: runtimeResult.localPath,
    requestPath: match.requestPath,
    params: match.params,
    query: runtimeResult.query,
    locale: lang,
    pathname: `/${lang}${match.requestPath === '/' ? '' : match.requestPath}`,
    requestHeaders,
    data: runtimeResult.data,
  });

  return (
    <IntlMessagesProvider scope="site">
      <ShellLayout pathname={match.requestPath} locale={lang}>
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

async function resolveAliasRuntimePageOrNotFound(
  match: NonNullable<Awaited<ReturnType<typeof resolvePluginPublicRouteAlias>>>,
  requestHeaders: Headers,
  lang: string,
  query?: Record<string, string | string[] | undefined>
) {
  try {
    return await resolvePluginPageRuntime(match.pluginId, match.slug, requestHeaders, {
      entry: match.entry ?? undefined,
      locale: lang,
      routeMatch: { route: match.route, params: match.params },
      query,
      requestPathOverride: match.requestPath,
    });
  } catch (error) {
    handleRuntimePageResolutionError(error, lang, match.pluginId, match.requestPath);
  }
}

function handleRuntimePageResolutionError(
  error: unknown,
  lang: string,
  pluginId: string,
  requestPath: string
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
    const callbackUrl = encodeURIComponent(`/${lang}${requestPath}`);
    redirect(`/${lang}/login?callbackUrl=${callbackUrl}`);
  }

  if (error instanceof PluginError && error.code === 'PLUGIN_ADMIN_REQUIRED') {
    redirect(`/${lang}/profile`);
  }

  if (isPluginCommercialError(error)) {
    redirect(createPluginCommercialRedirectPath(lang, pluginId, requestPath, error));
  }

  throw error;
}
