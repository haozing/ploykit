import {
  assertValidModuleRuntimeContract,
  normalizeModuleRuntimeContract,
  type ModuleRuntimeContract,
  type RuntimeModuleDefinition,
} from '../contract';
import type { ModuleMapArtifact, ModuleRuntimeMapEntry } from './module-map-types';

function readDefaultExport(value: unknown): unknown {
  if (value && typeof value === 'object' && 'default' in value) {
    return (value as { default: unknown }).default;
  }
  return value;
}

function isRuntimeModuleDefinition(value: unknown): value is RuntimeModuleDefinition {
  return Boolean(
    value && typeof value === 'object' && 'id' in value && 'name' in value && 'version' in value
  );
}

export async function loadModuleRuntimeContract(
  moduleId: string,
  entry: ModuleRuntimeMapEntry
): Promise<ModuleRuntimeContract> {
  if (entry.runtimeContract) {
    return entry.runtimeContract;
  }

  if (!entry.module) {
    throw new Error(`MODULE_LOADER_MISSING: module map entry "${moduleId}" has no module loader.`);
  }

  const loaded = readDefaultExport(await entry.module());
  if (!isRuntimeModuleDefinition(loaded)) {
    throw new Error(
      `MODULE_CONTRACT_INVALID_EXPORT: module "${moduleId}" did not export a module definition.`
    );
  }

  const contract = normalizeModuleRuntimeContract(loaded);
  assertValidModuleRuntimeContract(loaded, contract);
  if (contract.id !== moduleId) {
    throw new Error(
      `MODULE_ID_MISMATCH: module map key "${moduleId}" loaded contract "${contract.id}".`
    );
  }

  return contract;
}

export async function loadModuleRuntimeContracts(
  artifact: ModuleMapArtifact
): Promise<ModuleRuntimeContract[]> {
  const contracts: ModuleRuntimeContract[] = [];

  for (const [moduleId, entry] of Object.entries(artifact.modules)) {
    contracts.push(await loadModuleRuntimeContract(moduleId, entry));
  }

  return contracts;
}
