import { createElement, isValidElement, type ComponentType } from 'react';
import { readModuleDefaultExport } from '@/lib/module-runtime/adapters/module-export';
import type { ModuleHost } from '@/lib/module-runtime/host/create-module-host';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { renderModuleSurface } from '@/lib/module-runtime/ui/surface-renderer';

export async function callModuleComponent(component: unknown, props?: unknown): Promise<unknown> {
  const exported = readModuleDefaultExport(component);
  if (typeof exported === 'function') {
    return (exported as (props?: unknown) => unknown | Promise<unknown>)(props);
  }

  return exported;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export interface RenderPageComponentOptions {
  strictReactOutput?: boolean;
}

function renderStrictReactPageComponent(component: unknown, props: unknown): unknown {
  const exported = readModuleDefaultExport(component);
  if (isValidElement(exported)) {
    return exported;
  }
  if (typeof exported === 'function') {
    return createElement(
      exported as ComponentType<Record<string, unknown>>,
      isRecord(props) ? props : {}
    );
  }

  if (exported === null || exported === undefined) {
    return exported;
  }

  throw new Error(
    'MODULE_PAGE_RENDER_OUTPUT_INVALID: clean-slate module pages must export a JSX/React component.'
  );
}

export async function renderPageComponent(
  component: unknown,
  props: unknown,
  options: RenderPageComponentOptions = {}
): Promise<unknown> {
  if (options.strictReactOutput) {
    return renderStrictReactPageComponent(component, props);
  }

  const output = await callModuleComponent(component, props);

  if (
    isRecord(output) &&
    typeof output.view === 'string' &&
    isRecord(props) &&
    !('loaderData' in output)
  ) {
    return {
      ...output,
      loaderData: props.loaderData,
      params: props.params,
      metadata: props.metadata,
      language: props.language,
      dashboardBaseHref: props.dashboardBaseHref,
    };
  }

  return output;
}

export async function renderDashboardSurface(
  host: ModuleHost,
  request: Request,
  session: ModuleHostSession
) {
  return renderModuleSurface(host.runtime, {
    request,
    surfaceId: 'dashboard.home:widgets',
    session,
    renderComponent({ component, loaderData }) {
      return callModuleComponent(component, { loaderData });
    },
  });
}
