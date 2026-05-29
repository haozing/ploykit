import {
  createModuleCatalogApplyPlan,
  type CreateModuleCatalogApplyPlanInput,
} from './catalog-apply';
import type {
  ModuleCatalogApplyPlan,
  ModuleCatalogBundle,
  ModuleCatalogModuleState,
  ModuleCatalogProduct,
  ModuleCatalogSnapshot,
  ModuleCatalogSuite,
} from './catalog-types';

export interface ModuleCatalogStore {
  getSnapshot(): Promise<ModuleCatalogSnapshot>;
  upsertProduct(product: ModuleCatalogProduct): Promise<void>;
  upsertBundle(bundle: ModuleCatalogBundle): Promise<void>;
  setModuleState(state: ModuleCatalogModuleState): Promise<void>;
  applyBundle(
    input: Omit<CreateModuleCatalogApplyPlanInput, 'existingStates'>
  ): Promise<ModuleCatalogApplyPlan>;
}

export function createInMemoryModuleCatalogStore(
  initial: ModuleCatalogSnapshot = {
    version: 1,
    products: [],
    suites: [],
    bundles: [],
    moduleStates: [],
  }
): ModuleCatalogStore {
  const products = new Map(initial.products.map((product) => [product.id, product]));
  const suites = new Map((initial.suites ?? []).map((suite) => [suite.id, suite]));
  const bundles = new Map(initial.bundles.map((bundle) => [bundle.id, bundle]));
  const states = new Map(
    initial.moduleStates.map((state) => [`${state.productId}:${state.moduleId}`, state])
  );

  return {
    async getSnapshot() {
      return {
        version: 1,
        products: [...products.values()],
        suites: [...suites.values()] as ModuleCatalogSuite[],
        bundles: [...bundles.values()],
        moduleStates: [...states.values()],
      };
    },
    async upsertProduct(product) {
      products.set(product.id, product);
    },
    async upsertBundle(bundle) {
      bundles.set(bundle.id, bundle);
    },
    async setModuleState(state) {
      states.set(`${state.productId}:${state.moduleId}`, state);
    },
    async applyBundle(input) {
      const plan = createModuleCatalogApplyPlan({
        ...input,
        existingStates: [...states.values()],
      });
      for (const state of plan.desiredStates) {
        states.set(`${state.productId}:${state.moduleId}`, state);
      }
      return plan;
    },
  };
}
