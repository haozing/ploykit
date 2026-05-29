import {
  hasModuleDiagnosticErrors,
  validateModuleDefinition,
  type ModuleDiagnostic,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract, RuntimeModuleDefinition } from './types';

export function validateModuleRuntimeContract(
  definition: RuntimeModuleDefinition,
  _contract: ModuleRuntimeContract
): ModuleDiagnostic[] {
  return validateModuleDefinition(definition);
}

export function assertValidModuleRuntimeContract(
  definition: RuntimeModuleDefinition,
  contract: ModuleRuntimeContract
): void {
  const diagnostics = validateModuleRuntimeContract(definition, contract);
  if (hasModuleDiagnosticErrors(diagnostics)) {
    const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    throw new TypeError(
      firstError ? `${firstError.code}: ${firstError.message}` : 'Invalid module contract'
    );
  }
}
