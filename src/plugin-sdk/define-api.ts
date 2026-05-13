import type { DefinedApi, PluginApiDefinition, PluginApiMethodName } from './types';

const API_METHODS: readonly PluginApiMethodName[] = ['get', 'post', 'put', 'patch', 'delete'];

export function defineApi<const TDefinition extends PluginApiDefinition>(
  definition: TDefinition
): DefinedApi<TDefinition> {
  const hasHandler = API_METHODS.some((method) => typeof definition[method] === 'function');

  if (!hasHandler) {
    throw new TypeError('defineApi() requires at least one HTTP method handler.');
  }

  return Object.freeze({
    ...definition,
    $$ploykit: {
      type: 'ploykit.api',
      sdkVersion: '0.1.0',
    },
  }) as DefinedApi<TDefinition>;
}
