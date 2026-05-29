import type { ModuleActionDefinition } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';

export interface ModuleRuntimeActionEntry {
  moduleId: string;
  name: string;
  action: ModuleActionDefinition;
}

export class ModuleActionRegistry {
  private readonly actions = new Map<string, ModuleRuntimeActionEntry>();

  clear(): void {
    this.actions.clear();
  }

  registerContract(contract: ModuleRuntimeContract): void {
    for (const [name, action] of Object.entries(contract.actions)) {
      const key = this.key(contract.id, name);
      if (this.actions.has(key)) {
        throw new Error(`Module action "${contract.id}.${name}" is already registered.`);
      }
      this.actions.set(key, { moduleId: contract.id, name, action });
    }
  }

  get(moduleId: string, name: string): ModuleRuntimeActionEntry | null {
    return this.actions.get(this.key(moduleId, name)) ?? null;
  }

  list(moduleId?: string): ModuleRuntimeActionEntry[] {
    const values = [...this.actions.values()];
    return moduleId ? values.filter((entry) => entry.moduleId === moduleId) : values;
  }

  private key(moduleId: string, name: string): string {
    return `${moduleId}:${name}`;
  }
}

export function createModuleActionRegistry(
  contracts: readonly ModuleRuntimeContract[]
): ModuleActionRegistry {
  const registry = new ModuleActionRegistry();
  for (const contract of contracts) {
    registry.registerContract(contract);
  }
  return registry;
}
