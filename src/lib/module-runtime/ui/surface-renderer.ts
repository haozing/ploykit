import type { ModuleContext } from '@ploykit/module-sdk';
import { createModuleRuntimeContext } from '../context';
import type { ModuleRuntimeHost } from '../host';
import { readModuleDefaultExport } from '../adapters';
import type { ModuleRuntimeSurfaceContribution } from '../surfaces';
import {
  resolveModuleSurfaceContributions,
  type ModuleSurfaceResolutionDiagnostic,
  type ResolvedModuleSurfaceContribution,
} from '../adapters';
import type { ModuleRuntimeAccessSession } from '../security';

export interface RenderModuleSurfaceInput {
  request: Request;
  surfaceId: string;
  contributions?: readonly ModuleRuntimeSurfaceContribution[];
  session?: ModuleRuntimeAccessSession;
  params?: Record<string, string>;
  loaderDataByModuleId?: ReadonlyMap<string, unknown> | Record<string, unknown>;
  isolateErrors?: boolean;
  onDiagnostic?: (diagnostic: RenderedModuleSurfaceDiagnostic) => void;
  renderComponent?: (input: RenderModuleSurfaceComponentInput) => unknown | Promise<unknown>;
}

export interface RenderModuleSurfaceComponentInput {
  contribution: ResolvedModuleSurfaceContribution;
  component: unknown;
  loaderData: unknown;
}

export interface RenderedModuleSurfaceContribution {
  moduleId: string;
  surfaceId: string;
  mode: NonNullable<ResolvedModuleSurfaceContribution['definition']['mode']>;
  priority: number;
  component: unknown;
  loaderData: unknown;
  rendered: unknown;
  contribution: ResolvedModuleSurfaceContribution;
}

export interface RenderedModuleSurfaceDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  moduleId?: string;
  surfaceId: string;
}

export interface RenderedModuleSurface {
  surfaceId: string;
  append: RenderedModuleSurfaceContribution[];
  prepend: RenderedModuleSurfaceContribution[];
  panel: RenderedModuleSurfaceContribution[];
  action: RenderedModuleSurfaceContribution[];
  replace: RenderedModuleSurfaceContribution[];
  all: RenderedModuleSurfaceContribution[];
  diagnostics: RenderedModuleSurfaceDiagnostic[];
}

async function loadDefault(loader: () => Promise<unknown>): Promise<unknown> {
  return readModuleDefaultExport(await loader());
}

function preloadedLoaderData(
  input: RenderModuleSurfaceInput,
  moduleId: string
): { found: boolean; value: unknown } {
  const source = input.loaderDataByModuleId;
  if (!source) {
    return { found: false, value: undefined };
  }
  if (source instanceof Map) {
    return source.has(moduleId)
      ? { found: true, value: source.get(moduleId) }
      : { found: false, value: undefined };
  }
  const record = source as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, moduleId)
    ? { found: true, value: record[moduleId] }
    : { found: false, value: undefined };
}

function createSurfaceContext(
  host: ModuleRuntimeHost,
  contribution: ResolvedModuleSurfaceContribution,
  input: RenderModuleSurfaceInput
): ModuleContext {
  const contract = host.getContract(contribution.moduleId);
  if (!contract) {
    throw new Error(`MODULE_SURFACE_CONTRACT_MISSING: ${contribution.moduleId}`);
  }

  const session = input.session ?? { user: null };
  return createModuleRuntimeContext({
    contract,
    request: input.request,
    user: session.user,
    params: input.params,
    data: host.createDataApi?.({
      contract,
      request: input.request,
      user: session.user,
      params: input.params ?? {},
      session,
    }),
    session,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fromResolutionDiagnostic(
  diagnostic: ModuleSurfaceResolutionDiagnostic
): RenderedModuleSurfaceDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    moduleId: diagnostic.moduleId,
    surfaceId: diagnostic.surfaceId,
  };
}

function recordDiagnostic(
  diagnostics: RenderedModuleSurfaceDiagnostic[],
  input: RenderModuleSurfaceInput,
  diagnostic: RenderedModuleSurfaceDiagnostic
): void {
  diagnostics.push(diagnostic);
  input.onDiagnostic?.(diagnostic);
}

function renderErrorDiagnostic(
  code: string,
  stage: string,
  contribution: ResolvedModuleSurfaceContribution,
  error: unknown
): RenderedModuleSurfaceDiagnostic {
  return {
    severity: 'error',
    code,
    message: `Module "${contribution.moduleId}" surface "${contribution.surfaceId}" ${stage} failed: ${errorMessage(error)}`,
    moduleId: contribution.moduleId,
    surfaceId: contribution.surfaceId,
  };
}

export async function renderModuleSurface(
  host: ModuleRuntimeHost,
  input: RenderModuleSurfaceInput
): Promise<RenderedModuleSurface> {
  const diagnostics: RenderedModuleSurfaceDiagnostic[] = [];
  const contributions = resolveModuleSurfaceContributions(host, input.surfaceId, {
    session: input.session,
    contributions: input.contributions,
    continueOnError: input.isolateErrors,
    onDiagnostic(diagnostic) {
      recordDiagnostic(diagnostics, input, fromResolutionDiagnostic(diagnostic));
    },
  });
  const rendered: RenderedModuleSurfaceContribution[] = [];

  for (const contribution of contributions) {
    let component: unknown;
    try {
      component = await loadDefault(contribution.component);
    } catch (error) {
      if (!input.isolateErrors) {
        throw error;
      }
      recordDiagnostic(
        diagnostics,
        input,
        renderErrorDiagnostic('MODULE_SURFACE_COMPONENT_LOAD_FAILED', 'component load', contribution, error)
      );
      continue;
    }

    let context: ModuleContext;
    try {
      context = createSurfaceContext(host, contribution, input);
    } catch (error) {
      if (!input.isolateErrors) {
        throw error;
      }
      recordDiagnostic(
        diagnostics,
        input,
        renderErrorDiagnostic('MODULE_SURFACE_CONTEXT_FAILED', 'context creation', contribution, error)
      );
      continue;
    }

    const preloaded = preloadedLoaderData(input, contribution.moduleId);
    let loaderData: unknown;
    try {
      const loaderExport =
        preloaded.found || !contribution.loader ? null : await loadDefault(contribution.loader);
      loaderData = preloaded.found
        ? preloaded.value
        : typeof loaderExport === 'function'
          ? await (loaderExport as (ctx: ModuleContext) => unknown | Promise<unknown>)(context)
          : loaderExport;
    } catch (error) {
      if (!input.isolateErrors) {
        throw error;
      }
      recordDiagnostic(
        diagnostics,
        input,
        renderErrorDiagnostic('MODULE_SURFACE_LOADER_FAILED', 'loader', contribution, error)
      );
      continue;
    }

    let output: unknown = null;
    if (input.renderComponent) {
      try {
        output = await input.renderComponent({ contribution, component, loaderData });
      } catch (error) {
        if (!input.isolateErrors) {
          throw error;
        }
        recordDiagnostic(
          diagnostics,
          input,
          renderErrorDiagnostic('MODULE_SURFACE_COMPONENT_RENDER_FAILED', 'component render', contribution, error)
        );
        continue;
      }
    }

    rendered.push({
      moduleId: contribution.moduleId,
      surfaceId: contribution.surfaceId,
      mode: contribution.definition.mode ?? 'append',
      priority: contribution.priority,
      component,
      loaderData,
      rendered: output,
      contribution,
    });
  }

  return {
    surfaceId: input.surfaceId,
    append: rendered.filter((item) => item.mode === 'append'),
    prepend: rendered.filter((item) => item.mode === 'prepend'),
    panel: rendered.filter((item) => item.mode === 'panel'),
    action: rendered.filter((item) => item.mode === 'action'),
    replace: rendered.filter((item) => item.mode === 'replace'),
    all: rendered,
    diagnostics,
  };
}
