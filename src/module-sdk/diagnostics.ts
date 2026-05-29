export type ModuleDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ModuleDiagnostic {
  code: string;
  severity: ModuleDiagnosticSeverity;
  message: string;
  path?: string;
  fix?: string;
  line?: number;
  column?: number;
  category?: 'contract' | 'source' | 'runtime' | 'map' | 'data' | 'presentation' | 'security';
  subsystem?:
    | 'module'
    | 'routes'
    | 'actions'
    | 'surfaces'
    | 'data'
    | 'i18n'
    | 'theme'
    | 'permissions'
    | 'doctor'
    | 'module-map'
    | 'runtime-host';
  details?: Record<string, unknown>;
}

export interface CreateModuleDiagnosticInput {
  code: string;
  severity: ModuleDiagnosticSeverity;
  message: string;
  path?: string;
  fix?: string;
  line?: number;
  column?: number;
  category?: ModuleDiagnostic['category'];
  subsystem?: ModuleDiagnostic['subsystem'];
  details?: Record<string, unknown>;
}

export function createModuleDiagnostic(input: CreateModuleDiagnosticInput): ModuleDiagnostic {
  return { ...input };
}

export function hasModuleDiagnosticErrors(diagnostics: readonly ModuleDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
