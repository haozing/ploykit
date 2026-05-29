import type { ModuleConfigApi } from '@ploykit/module-sdk';

export function createStaticModuleConfigApi(values: Record<string, unknown>): ModuleConfigApi {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      return Object.hasOwn(values, key) ? (values[key] as T) : null;
    },
    async require<T = unknown>(key: string): Promise<T> {
      if (!Object.hasOwn(values, key)) {
        throw new Error(`MODULE_CONFIG_MISSING: ${key}`);
      }
      return values[key] as T;
    },
  };
}
