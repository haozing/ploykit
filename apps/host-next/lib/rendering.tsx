import { createElement, type ElementType, type ReactNode } from 'react';
import { readModuleDefaultExport } from '@/lib/module-runtime/adapters/module-export';
import type { ModuleHost } from '@/lib/module-runtime/host/create-module-host';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { renderModuleSurface } from '@/lib/module-runtime/ui/surface-renderer';

export function callModuleComponent(component: unknown, props?: unknown): ReactNode {
  const exported = readModuleDefaultExport(component);
  if (!isReactComponentType(exported)) {
    throw new TypeError('Module UI entry must export a valid React component type.');
  }

  return createElement(exported as ElementType, props as Record<string, unknown>);
}

function isReactComponentType(value: unknown): boolean {
  if (typeof value === 'function') {
    return true;
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  const reactType = (value as { $$typeof?: symbol }).$$typeof;
  return (
    reactType === Symbol.for('react.forward_ref') ||
    reactType === Symbol.for('react.memo') ||
    reactType === Symbol.for('react.lazy')
  );
}

export function renderPageComponent(component: unknown, props: unknown): ReactNode {
  return callModuleComponent(component, props);
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
