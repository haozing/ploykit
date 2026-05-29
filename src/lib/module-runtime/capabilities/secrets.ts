import type { ModuleSecretsApi } from '@ploykit/module-sdk';

export function createStaticModuleSecretsApi(values: Record<string, string>): ModuleSecretsApi {
  return {
    async get(name: string): Promise<string | null> {
      return Object.hasOwn(values, name) ? values[name] : null;
    },
    async require(name: string): Promise<string> {
      if (!Object.hasOwn(values, name)) {
        throw new Error(`MODULE_SECRET_MISSING: ${name}`);
      }
      return values[name];
    },
  };
}
