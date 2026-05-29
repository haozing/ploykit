import type { ModuleSurfaceDefinition } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';

export interface ModuleRuntimeSurfaceContribution {
  moduleId: string;
  surfaceId: string;
  priority: number;
  definition: ModuleSurfaceDefinition;
}

export class ModuleSurfaceRegistry {
  private readonly surfaces = new Map<string, ModuleRuntimeSurfaceContribution[]>();

  clear(): void {
    this.surfaces.clear();
  }

  registerContract(contract: ModuleRuntimeContract): void {
    for (const [surfaceId, definition] of Object.entries(contract.surfaces)) {
      const contributions = this.surfaces.get(surfaceId) ?? [];
      contributions.push({
        moduleId: contract.id,
        surfaceId,
        priority: definition.priority ?? 0,
        definition: {
          mode: 'append',
          ...definition,
        },
      });
      contributions.sort((left, right) => right.priority - left.priority);
      this.surfaces.set(surfaceId, contributions);
    }
  }

  get(surfaceId: string): readonly ModuleRuntimeSurfaceContribution[] {
    return this.surfaces.get(surfaceId) ?? [];
  }

  list(): ModuleRuntimeSurfaceContribution[] {
    return [...this.surfaces.values()].flat();
  }
}

export function createModuleSurfaceRegistry(
  contracts: readonly ModuleRuntimeContract[]
): ModuleSurfaceRegistry {
  const registry = new ModuleSurfaceRegistry();
  for (const contract of contracts) {
    registry.registerContract(contract);
  }
  return registry;
}
