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

export async function renderPageComponent(component: unknown, props: unknown): Promise<unknown> {
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
