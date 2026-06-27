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
    { id: 'app', path: 'templates/modules/app', capabilities: ['pages', 'tsx', 'ui'] },
    {
      id: 'resource',
      path: 'templates/modules/resource',
      capabilities: ['resources', 'schema', 'data', 'openapi'],
    },
    {
      id: 'tool',
      path: 'templates/modules/tool',
      capabilities: ['pages', 'actions', 'api', 'schema'],
    },
    { id: 'connector', path: 'templates/modules/connector', capabilities: ['connectors', 'jobs'] },
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
