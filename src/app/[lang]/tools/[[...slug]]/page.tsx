import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { PluginError } from '@ploykit/plugin-sdk';
import {
  createPluginCommercialRedirectPath,
  createPluginToolMetadata,
  createPluginToolStructuredDataScripts,
  isPluginCommercialError,
  resolvePluginPageRuntime,
  resolvePluginToolRoute,
} from '@/lib/plugin-runtime';
import { PluginRuntimePageRenderer } from '@/components/plugins/plugin-runtime-page-renderer';
import { ShellLayout } from '@/components/layouts/ShellLayout';
import type { RuntimePageRoute } from '@/lib/plugin-runtime';

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
  return route?.tool
    ? createPluginToolMetadata(route.tool, {
        locale: lang,
        pathname: `/${lang}/${localToolPath(slug)}`,
      })
    : {};
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
  const structuredDataScripts = runtimeResult.route.tool
    ? createPluginToolStructuredDataScripts(runtimeResult.route.tool, { locale: lang })
    : [];

  return (
    <ShellLayout pathname={`/${localToolPath(slug)}`}>
      {structuredDataScripts.map((script) => (
        <script
          key={script.id}
          id={script.id}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: script.json }}
        />
      ))}
      <PluginRuntimePageRenderer result={runtimeResult} />
    </ShellLayout>
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
