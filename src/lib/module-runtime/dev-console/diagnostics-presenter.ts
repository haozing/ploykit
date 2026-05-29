import type { ModuleDiagnostic } from '@ploykit/module-sdk';

export interface PresentedModuleDiagnostics {
  errors: ModuleDiagnostic[];
  warnings: ModuleDiagnostic[];
  infos: ModuleDiagnostic[];
  aiFixPrompt: string;
}

export function presentModuleDiagnostics(input: {
  moduleId: string;
  diagnostics: readonly ModuleDiagnostic[];
}): PresentedModuleDiagnostics {
  const errors = input.diagnostics.filter((item) => item.severity === 'error');
  const warnings = input.diagnostics.filter((item) => item.severity === 'warning');
  const infos = input.diagnostics.filter((item) => item.severity === 'info');
  const lines = input.diagnostics.map((item) =>
    [`[${item.severity}] ${item.code}`, `path: ${item.path}`, item.fix ? `fix: ${item.fix}` : null]
      .filter(Boolean)
      .join('\n')
  );

  return {
    errors,
    warnings,
    infos,
    aiFixPrompt: [
      `You are fixing a PloyKit local module named "${input.moduleId}".`,
      'Do not use legacy plugin entrypoints, legacy key-value storage, direct database access, process.env, or host src/lib imports from module code.',
      'Fix these diagnostics using module contract and ctx capabilities only:',
      ...lines,
    ].join('\n\n'),
  };
}
