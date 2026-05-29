import {
  assertValidModuleRuntimeContract,
  normalizeModuleRuntimeContract,
  type ModuleRuntimeContract,
  type RuntimeModuleDefinition,
} from '../contract';

export class ModuleRuntimeRegistry {
  private readonly contracts = new Map<string, ModuleRuntimeContract>();

  clear(): void {
    this.contracts.clear();
  }

  registerDefinition(definition: RuntimeModuleDefinition, options: { replace?: boolean } = {}) {
    const contract = normalizeModuleRuntimeContract(definition);
    assertValidModuleRuntimeContract(definition, contract);
    this.registerContract(contract, options);
    return contract;
  }

  registerContract(contract: ModuleRuntimeContract, options: { replace?: boolean } = {}): void {
    if (this.contracts.has(contract.id) && !options.replace) {
      throw new Error(`Module runtime contract "${contract.id}" is already registered.`);
    }

    this.contracts.set(contract.id, contract);
  }

  get(moduleId: string): ModuleRuntimeContract | null {
    return this.contracts.get(moduleId) ?? null;
  }

  list(): ModuleRuntimeContract[] {
    return [...this.contracts.values()];
  }
}

export const moduleRuntimeRegistry = new ModuleRuntimeRegistry();
