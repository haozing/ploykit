/**
 * Hook Context Builder
 *
 * Creates runtime plugin execution context for hooks.
 */

import { createPluginRuntimeContext } from '@/lib/plugin-runtime/context';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import type { HookExecutionContext, AllHookName, HookPayloadMap } from './types';
import { getHookType } from './constants';

function createHookRequest(pluginId: string, hookName: string): Request {
  return new Request(`https://ploykit.local/plugins/${pluginId}/hooks/${hookName}`, {
    method: 'POST',
  });
}

/**
 */
export class HookContextBuilder {
  /**
   *
   * @template H - HookName
   * @param pluginId - PluginID
   * @param hookName - HookName
   * @param environment - ExecuteEnvironmentInformation
   */
  static async build<H extends AllHookName>(
    pluginId: string,
    hookName: H,
    environment: {
      userId?: string;
      requestId?: string;
    },
    payload?: HookPayloadMap[H]
  ): Promise<HookExecutionContext<HookPayloadMap[H]>> {
    const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
    const plugin = createPluginRuntimeContext({
      contract,
      request: createHookRequest(pluginId, hookName),
      user: environment.userId ? { id: environment.userId, role: 'user' } : null,
      requestId: environment.requestId,
      system: !environment.userId,
    });

    return {
      plugin,
      hook: {
        name: hookName,
        type: getHookType(hookName),
        trigger: `hook:${hookName}`,
      },
      environment: {
        ...environment,
        timestamp: new Date(),
      },
      payload,
    };
  }
}
