import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ErrorPanel } from '@host/components/layout/ErrorPanel';
import { ModuleValue } from '@host/components/ModuleValue';
import { adminNav, WorkspaceShell } from '@host/components/ProductShell';
import { requireAdminUser } from '@host/lib/auth';
import { getModuleHost } from '@host/lib/module-host';
import { adminHref, createHostRequest, modulePathFromSegments } from '@host/lib/paths';
import { readLanguageParam, type LanguageRouteParams } from '@host/lib/route-params';
import { HOST_LANGUAGE_HEADER, localizedAdminPath, type SupportedLanguage } from '@host/lib/i18n';
import { renderPageComponent } from '@host/lib/rendering';
import type { ResolveModulePageRouteResult } from '@/lib/module-runtime';

export const dynamic = 'force-dynamic';

const privateAdminRobots: Metadata['robots'] = {
  index: false,
  follow: false,
};

interface AdminModulePageProps {
  params: Promise<LanguageRouteParams & { modulePath?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function readMetadataString(metadata: unknown, key: 'title' | 'description'): string | undefined {
  if (!metadata || typeof metadata !== 'object' || !(key in metadata)) {
    return undefined;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

async function createScopedAdminRequest(
  pathname: string,
  lang: SupportedLanguage,
  query?: Record<string, string | string[] | undefined>
): Promise<Request> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host');
  const cookie = requestHeaders.get('cookie');
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined) {
          search.append(key, item);
        }
      }
    } else if (value !== undefined) {
      search.set(key, value);
    }
  }
  const target = search.size > 0 ? `${pathname}?${search}` : pathname;
  return createHostRequest(target, {
    headers: {
      ...(host ? { host } : {}),
      ...(cookie ? { cookie } : {}),
      [HOST_LANGUAGE_HEADER]: lang,
    },
  });
}

function adminModulePageChrome(
  result: ResolveModulePageRouteResult,
  lang: SupportedLanguage
): {
  title: string;
  description: string;
} {
  if (!result.ok) {
    return {
      title: lang === 'zh' ? '模块后台不可用' : 'Module Admin Unavailable',
      description:
        lang === 'zh'
          ? '这个模块后台页面当前不可访问，可能是路由未声明、权限不足或模块未启用。'
          : 'This module admin page is unavailable because the route is missing, access is denied, or the module is disabled.',
    };
  }

  const title =
    readMetadataString(result.page.metadata, 'title') ??
    `${result.page.contract.name} ${lang === 'zh' ? '后台' : 'Admin'}`;
  const description =
    readMetadataString(result.page.metadata, 'description') ??
    result.page.contract.description ??
    (lang === 'zh'
      ? '使用宿主管理后台 Shell 管理模块提供的后台能力。'
      : 'Manage module-provided admin capabilities inside the host admin shell.');

  return { title, description };
}

async function ModuleAdminPage({
  result,
  lang,
}: {
  result: ResolveModulePageRouteResult;
  lang: SupportedLanguage;
}) {
  if (!result.ok) {
    return <ErrorPanel status={result.status} code={result.code} message={result.message} />;
  }

  const output = await renderPageComponent(result.page.component, {
    params: result.page.params,
    loaderData: result.page.loaderData,
    metadata: result.page.metadata,
    language: lang,
  });

  return (
    <section className="rounded-md border border-admin-border bg-admin-surface p-5 shadow-admin-card">
      <ModuleValue value={output} />
    </section>
  );
}

export async function generateMetadata({ params }: AdminModulePageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const lang = await readLanguageParam(Promise.resolve(resolvedParams));
  const pathname = modulePathFromSegments(resolvedParams.modulePath);
  const host = await getModuleHost();
  const request = await createScopedAdminRequest(adminHref(pathname), lang);
  const session = await requireAdminUser(lang, localizedAdminPath(lang, pathname));
  const result = await host.resolvePageRoute({
    kind: 'admin',
    pathname,
    request,
    session,
  });
  const chrome = adminModulePageChrome(result, lang);

  return {
    title: `${chrome.title} | PloyKit Admin`,
    description: chrome.description,
    robots: privateAdminRobots,
  };
}

export default async function AdminModuleRoutePage({
  params,
  searchParams,
}: AdminModulePageProps) {
  const resolvedParams = await params;
  const query = searchParams ? await searchParams : {};
  const lang = await readLanguageParam(Promise.resolve(resolvedParams));
  const pathname = modulePathFromSegments(resolvedParams.modulePath);
  const session = await requireAdminUser(lang, localizedAdminPath(lang, pathname));
  const host = await getModuleHost();
  const request = await createScopedAdminRequest(adminHref(pathname), lang, query);
  const result = await host.resolvePageRoute({
    kind: 'admin',
    pathname,
    request,
    session,
  });
  const chrome = adminModulePageChrome(result, lang);

  return (
    <WorkspaceShell lang={lang} nav={adminNav} title={chrome.title} subtitle={chrome.description}>
      <ModuleAdminPage result={result} lang={lang} />
    </WorkspaceShell>
  );
}
