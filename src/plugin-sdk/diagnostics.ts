export type PluginDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface PluginDiagnostic {
  code: string;
  severity: PluginDiagnosticSeverity;
  message: string;
  path?: string;
  file?: string;
  fix?: string;
  docs?: string;
  details?: Record<string, unknown>;
}

export function createPluginDiagnostic(diagnostic: PluginDiagnostic): PluginDiagnostic {
  return diagnostic;
}

export function hasPluginDiagnosticErrors(diagnostics: readonly PluginDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function formatPluginDiagnostic(diagnostic: PluginDiagnostic): string {
  const location = diagnostic.path ? ` at ${diagnostic.path}` : '';
  const fix = diagnostic.fix ? ` Fix: ${diagnostic.fix}` : '';
  return `${diagnostic.code}${location}: ${diagnostic.message}${fix}`;
}

export function formatPluginDiagnostics(diagnostics: readonly PluginDiagnostic[]): string {
  return diagnostics.map(formatPluginDiagnostic).join('\n');
}
