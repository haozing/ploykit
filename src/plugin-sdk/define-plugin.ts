import type { DefinedPlugin, PluginDefinition } from './types';
import { formatPluginDiagnostic } from './diagnostics';
import { validatePluginDefinition } from './validator';

export function definePlugin<const TDefinition extends PluginDefinition>(
  definition: TDefinition
): DefinedPlugin<TDefinition> {
  const diagnostics = validatePluginDefinition(definition);
  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');

  if (firstError) {
    throw new TypeError(formatPluginDiagnostic(firstError));
  }

  return Object.freeze({
    ...definition,
    $$ploykit: {
      type: 'ploykit.plugin',
      sdkVersion: '0.1.0',
    },
  }) as DefinedPlugin<TDefinition>;
}
