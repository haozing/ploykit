import type { ModuleRuntimeHost } from '../host';
import {
  resolveModulePageRoute,
  type ModulePageRouteKind,
  type ResolveModulePageRouteResult,
  type ResolvedModulePageRoute,
} from '../adapters';
import type { ModuleRuntimeAccessSession } from '../security';
import { resolveModuleRouteCachePolicy, type ModuleRouteCachePolicy } from './cache-runtime';
import { createModulePageSeoMetadata, type ModuleSeoMetadata } from './seo-runtime';

export interface RenderModulePageInput {
  request: Request;
  kind: ModulePageRouteKind;
  pathname: string;
  session?: ModuleRuntimeAccessSession;
  params?: Record<string, string>;
  hostBaseUrl?: string;
  renderComponent?: (input: RenderModulePageComponentInput) => unknown | Promise<unknown>;
}

export interface RenderModulePageComponentInput {
  page: ResolvedModulePageRoute;
  props: ModulePageRenderProps;
}

export interface ModulePageRenderProps {
  module: {
    id: string;
    version: string;
  };
  route: ResolvedModulePageRoute['route'];
  params: Record<string, string>;
  loaderData: unknown;
  metadata: unknown;
  language?: string;
}

export interface RenderedModulePage {
  moduleId: string;
  kind: ModulePageRouteKind;
  shell: ModulePageRouteKind;
  component: unknown;
  props: ModulePageRenderProps;
  rendered: unknown;
  seo: ModuleSeoMetadata;
  cache: ModuleRouteCachePolicy;
  route: ResolvedModulePageRoute;
}

export type RenderModulePageResult =
  | {
      ok: true;
      status: 200;
      page: RenderedModulePage;
    }
  | Extract<ResolveModulePageRouteResult, { ok: false }>;

export async function renderModulePage(
  host: ModuleRuntimeHost,
  input: RenderModulePageInput
): Promise<RenderModulePageResult> {
  const result = await resolveModulePageRoute(host, {
    request: input.request,
    kind: input.kind,
    pathname: input.pathname,
    session: input.session,
    params: input.params,
  });

  if (!result.ok) {
    return result;
  }

  const page = result.page;
  const language = input.request.headers.get('x-ploykit-lang') ?? undefined;
  const props: ModulePageRenderProps = {
    module: {
      id: page.contract.id,
      version: page.contract.version,
    },
    route: page.route,
    params: page.params,
    loaderData: page.loaderData,
    metadata: page.metadata,
    language,
  };

  try {
    const rendered = input.renderComponent ? await input.renderComponent({ page, props }) : null;

    return {
      ok: true,
      status: 200,
      page: {
        moduleId: page.moduleId,
        kind: page.kind,
        shell: page.kind,
        component: page.component,
        props,
        rendered,
        seo: createModulePageSeoMetadata(page, input.hostBaseUrl),
        cache: resolveModuleRouteCachePolicy(page.route),
        route: page,
      },
    };
  } catch {
    return {
      ok: false,
      status: 500,
      code: 'MODULE_PAGE_RENDER_ERROR',
      message: 'Module page render failed.',
    };
  }
}
