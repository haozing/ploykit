import type { ModuleDiagnostic } from './diagnostics';
import { validateServiceRequirement } from './validator-service-requirements';
import type { ModuleDefinition } from './types';

export function validateDependencies(_diagnostics: ModuleDiagnostic[], _definition: ModuleDefinition): void {}
export function validateEgress(_diagnostics: ModuleDiagnostic[], _definition: ModuleDefinition): void {}

export function validateCapabilityMetadata(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  for (const [name, requirement] of Object.entries(definition.serviceRequirements ?? {})) {
    validateServiceRequirement(diagnostics, definition, name, requirement);
  }
  for (const [name, meter] of Object.entries(definition.commercial?.meters ?? {})) {
    if (meter.unit !== undefined && !meter.unit.trim()) {
      diagnostics.push({
        code: 'MODULE_METER_UNIT_EMPTY',
        severity: 'error',
        message: `Meter "${name}" unit must not be empty when declared.`,
        path: `commercial.meters.${name}.unit`,
      });
    }
  }
}
