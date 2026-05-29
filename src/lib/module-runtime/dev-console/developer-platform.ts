import type { ModuleDiagnostic } from '@ploykit/module-sdk';
import type { ModuleDevConsoleSnapshot } from './dev-console';
import { presentModuleDiagnostics } from './diagnostics-presenter';

export interface DeveloperPlatformTemplate {
  id: string;
  path: string;
  capabilities: readonly string[];
}

export interface DeveloperPlatformReport {
  snapshot: ModuleDevConsoleSnapshot;
  templates: DeveloperPlatformTemplate[];
  modulesWithErrors: string[];
  aiFixPrompts: Record<string, string>;
}

export function createDeveloperPlatformReport(input: {
  snapshot: ModuleDevConsoleSnapshot;
  diagnosticsByModule?: Record<string, readonly ModuleDiagnostic[]>;
  templates?: readonly DeveloperPlatformTemplate[];
}): DeveloperPlatformReport {
  const templates = input.templates ?? [
    { id: 'basic', path: 'templates/modules/basic', capabilities: ['routes', 'actions'] },
    {
      id: 'dashboard',
      path: 'templates/modules/dashboard',
      capabilities: ['dashboard', 'surfaces'],
    },
    {
      id: 'product-app',
      path: 'templates/modules/product-app',
      capabilities: ['site', 'dashboard', 'admin', 'product'],
    },
    { id: 'crud', path: 'templates/modules/crud', capabilities: ['data', 'actions', 'api'] },
    { id: 'connector', path: 'templates/modules/connector', capabilities: ['connectors', 'jobs'] },
    {
      id: 'signed-service',
      path: 'templates/modules/signed-service',
      capabilities: ['services', 'secretRefs', 'audit'],
    },
    { id: 'job', path: 'templates/modules/job', capabilities: ['jobs', 'events'] },
    {
      id: 'billing-aware',
      path: 'templates/modules/billing-aware',
      capabilities: ['billing', 'credits'],
    },
    { id: 'ai-rag', path: 'templates/modules/ai-rag', capabilities: ['ai', 'rag', 'files'] },
  ];
  const modulesWithErrors = input.snapshot.modules
    .filter((module) => module.status === 'error')
    .map((module) => module.id);
  const aiFixPrompts = Object.fromEntries(
    Object.entries(input.diagnosticsByModule ?? {}).map(([moduleId, diagnostics]) => [
      moduleId,
      presentModuleDiagnostics({ moduleId, diagnostics }).aiFixPrompt,
    ])
  );

  return {
    snapshot: input.snapshot,
    templates: [...templates],
    modulesWithErrors,
    aiFixPrompts,
  };
}
