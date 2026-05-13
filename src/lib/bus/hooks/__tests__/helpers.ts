/**
 * Hooks System å¨´å¬­ç¯æå­å§ªå®¸ã¥å¿
 *
 * æ©æ¬éToolå¦æ¬¢Canå­æå¨´å¬­ç¯æ¶îç¶é¢ã§æ®å®¸ã¥å¿Functionéä¸®ockCreateCan£ã¥æ°Toolî¡âæå­å§ª, * é©î¾æ®Toolîåºçæ¦å¸æ¾¶å¶å¬é®ä¾ç´çâç¥´çææ´¿Toolæ¹î°éä½¹æ´¿Toolæ¶æ·®é¶ãâ¬? */

import { vi, expect } from 'vitest';
import type { AllHookName, HookExecutionResult } from '../types';

// ============================================================================
// Mock Handler CreateCan£?// ============================================================================

/**
 * Createa îçCanæ æ® Mock Handler
 *
 * @param returnValue - HandlerReturné¨å«â¬ç¡·ç´Canîâ¬å¤ç´
 * @returns MockFunction
 *
 * @example
 * ```typescript
 * const handler = createMockHandler({ success: true });
 * hookSystem.register('test-plugin', 'onRenderHead', handler, 50);
 * ```
 */
export function createMockHandler(returnValue?: unknown) {
  return vi.fn(async () => returnValue);
}

/**
 * Createa îç«Name Mock Handleréå ç©¶æµåº¤ççæªç´
 *
 * @param name - HandlerName
 * @param returnValue - ReturnCan? * @returns MockFunction
 */
export function createNamedMockHandler(name: string, returnValue?: unknown) {
  const handler = vi.fn(async (_context: unknown) => {
    console.log(`[Mock Handler: ${name}] Executed`);
    return returnValue;
  });

  // SettingsFunctionNameéå ææ¸è¯ççæªç´
  Object.defineProperty(handler, 'name', { value: name });

  return handler;
}

/**
 * Createa îç´°é¶æ¶å­Errorî¤ Handler
 *
 * @param errorMessage - Errorî¤å¨å ä¼
 * @returns MockFunction
 *
 * @example
 * ```typescript
 * const failingHandler = createFailingHandler('Database connection failed');
 * ```
 */
export function createFailingHandler(errorMessage: string = 'Handler failed') {
  return vi.fn(async () => {
    throw new Error(errorMessage);
  });
}

/**
 * Createa îæ¬¢æ©ç¸å¢½çå²æ® Handler
 *
 * @param delay - å¯¤æ°ç¹Timeéå î ç»æç´
 * @param returnValue - ReturnCan? * @returns MockFunction
 *
 * @example
 * ```typescript
 * const slowHandler = createDelayedHandler(1000, 'result');
 * // handleræµ¼æ°±çå¯°?ç»æåReturn
 * ```
 */
export function createDelayedHandler(delay: number, returnValue?: unknown) {
  return vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return returnValue;
  });
}

// ============================================================================
// Batch operationæå­å§ª
// ============================================================================

/**
 * BatchRegisteræ¾¶æ°«éhooks
 *
 * @param hookSystem - UnifiedHookSystemInstance
 * @param registrations - RegisterInformationArray
 *
 * @example
 * ```typescript
 * registerMultiple(hookSystem, [
 *   { pluginId: 'plugin-a', hookName: 'onRenderHead', handler: h1, priority: 10 },
 *   { pluginId: 'plugin-b', hookName: 'onRenderHead', handler: h2, priority: 50 },
 * ]);
 * ```
 */
export function registerMultiple(
  hookSystem: {
    register: (
      pluginId: string,
      hookName: AllHookName,
      handler: (context: unknown) => unknown | Promise<unknown>,
      priority?: number
    ) => void;
  },
  registrations: Array<{
    pluginId: string;
    hookName: AllHookName;
    handler: (context: unknown) => unknown | Promise<unknown>;
    priority?: number;
  }>
) {
  registrations.forEach(({ pluginId, hookName, handler, priority = 100 }) => {
    hookSystem.register(pluginId, hookName, handler, priority);
  });
}

// ============================================================================
// Function
// ============================================================================

/**
 * VerificationExecuteîç¼æ´çé¨å«çToolîç²¨Tool? *
 * @param results - Executeîç¼æ´çArray
 *
 * @example
 * ```typescript
 * const results = await hookSystem.execute('onRenderHead', env, payload);
 * expectValidExecutionResults(results);
 * ```
 */
export function expectValidExecutionResults(results: HookExecutionResult[]) {
  expect(Array.isArray(results)).toBe(true);

  results.forEach((result) => {
    // VerificationCan©çæ¹°Fieldîçæ¨ºæ¹ª
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('pluginId');
    expect(result).toHaveProperty('duration');
    expect(result).toHaveProperty('executedAt');

    // VerificationFieldîType
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.pluginId).toBe('string');
    expect(typeof result.duration).toBe('number');
    expect(result.executedAt).toBeInstanceOf(Date);

    // VerificationdurationToolîæéåæ®
    expect(result.duration).toBeGreaterThanOrEqual(0);

    // IfSuccesséå±½ç°²çã¦æ¹dataé´æ ¨çToolå¡­rror
    if (result.success) {
      expect(result.error).toBeUndefined();
    } else {
      // IfFailedéå±½ç°²çã¦æ¹errorFieldî
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    }
  });
}

/**
 * Verificationéµâ¬Toolå¤ç²¨Toolæ»åSuccess
 *
 * @param results - Executeîç¼æ´çArray
 */
export function expectAllSuccessful(results: HookExecutionResult[]) {
  results.forEach((result, index) => {
    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(`Result ${index} failed:`, result.error);
    }
  });
}

/**
 * Verificationéç°ç¾Toolä¼´åºé¨å¬åCanç·æ°Failed
 *
 * @param results - Executeîç¼æ´çArray
 * @param expectedSuccess - æ£°å¬æ¹¡SuccessToolä¼´åº
 * @param expectedFailure - æ£°å¬æ¹¡FailedToolä¼´åº
 */
export function expectSuccessFailureCounts(
  results: HookExecutionResult[],
  expectedSuccess: number,
  expectedFailure: number
) {
  const actualSuccess = results.filter((r) => r.success).length;
  const actualFailure = results.filter((r) => !r.success).length;

  expect(actualSuccess).toBe(expectedSuccess);
  expect(actualFailure).toBe(expectedFailure);
}

// ============================================================================
// ContextVerificationæå­å§ª
// ============================================================================

/**
 * VerificationContextç¼æ´ç¯ç¹å±¾æ£é¬? *
 * @param context - HookExecuteîæ¶å©ç¬New */
export function expectValidContext(context: {
  plugin: { id: string };
  hook: { name: string; type: string; trigger: string };
  environment: { userId?: string; timestamp: Date };
  payload?: unknown;
}) {
  // VerificationpluginFieldî
  expect(context.plugin).toBeDefined();
  expect(context.plugin.id).toBeDefined();

  // VerificationhookFieldî
  expect(context.hook).toBeDefined();
  expect(context.hook.name).toBeDefined();
  expect(context.hook.type).toBeDefined();
  expect(context.hook.trigger).toBeDefined();

  // VerificationenvironmentFieldî
  expect(context.environment).toBeDefined();
  expect(context.environment.timestamp).toBeInstanceOf(Date);

  // payloadCanîåToolç·ndefinedéå±¾å¢æµ ã¤ç¬å¯®ååVerification
}

// ============================================================================
//
// ============================================================================

/**
 * å¨å¯æHookSystemStatusä¾ç´å¨´å¬­ç¯Canåº¤çé¢îç´
 *
 * @param hookSystem - UnifiedHookSystemInstance
 */
export function cleanupHookSystem(hookSystem: { clear?: () => void }) {
  if (hookSystem && typeof hookSystem.clear === 'function') {
    hookSystem.clear();
  }
}

// ============================================================================
// DataGenerateCan£?// ============================================================================

/**
 * Generateå¨´å¬­ç¯é¢ã§æ®Environmentîî¨Object
 *
 * @param overrides - çåæ´Defaultî»Canè©æ®Fieldî
 * @returns Environmentîî¨Object
 */
export function createTestEnvironment(overrides?: { userId?: string; requestId?: string }) {
  return {
    userId: overrides?.userId || 'test-user-1',
    requestId: overrides?.requestId || 'test-request-1',
  };
}

/**
 * Generateå¨´å¬­ç¯é¢ã§æ®payload
 *
 * @param hookName - HookName
 * @returns çµç°ç°²é¨å¾ayload
 */
export function createTestPayload(hookName: AllHookName): unknown {
  switch (hookName) {
    case 'onRenderHead':
      return {
        url: 'https://example.com/test',
        pathname: '/test',
      };

    case 'onBeforeHandle':
    case 'onAfterHandle':
      return {
        request: new Request('https://example.com/test'),
        route: { path: '/test', method: 'GET' },
      };

    case 'onInstall':
      return {
        config: {},
        installedBy: 'admin',
      };

    case 'onEnable':
      return {
        previouslyEnabled: false,
      };

    default:
      return {};
  }
}

// ============================================================================
// Function
// ============================================================================

/**
 * Waité¸å§ç¾Timeéå ¢æ¤æµåº¡ç´å§ã¦ç¥´çæªç´
 *
 * @param ms - WaitTimeéå î ç»æç´
 *
 * @example
 * ```typescript
 * await waitFor(100); // 100ms
 * ```
 */
export function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * WaitToolâ²æ¬¢å©Â¤å»éå £ççã¡îToolã¯ç´
 *
 * @param condition - Toolâ²æ¬¢Function
 * @param timeout - TimeoutTimeéå î ç»æç´
 * @param interval - å¦«â¬Toolã©æ£¿éæç´å§£î¤î) * @returns Toolâ²æ¬¢å©Â¤å»Returntrueéå²ç§´Toolæ°ç¹Can¥çalse
 *
 * @example
 * ```typescript
 * const success = await waitForCondition(
 *   () => handler.mock.calls.length > 0,
 *   1000,
 *   50
 * );
 * ```
 */
export async function waitForCondition(
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 100
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return true;
    }
    await waitFor(interval);
  }

  return false;
}

// ============================================================================
// Useéå²æ½ªé·îå§©Canæ ¨ç¥´çæªç´
// ============================================================================
//
// Functioné¢ã¤ç°¬ManualDebugå¨´å¬­ç¯éîî½éå±¼ç¬Can¦ã¨åCanã¥å¯²å¨´å¬­ç¯æ¶î¡çé¢ã£â¬?// UseToolç°ç´¡éæ°¬æ¹ªå¨´å¬­ç¯æ¶îå¤ToolèµåCançºçé¢îç´Runîå¨´å¬­ç¯ViewOutputéå²ççæç¬é´æ¬æç»å©æ«,//
// )// ```typescript
// const results = await hookSystem.execute('onRenderHead', env, payload);
// debugPrintResults(results);  // ?// ```
// ============================================================================

/**
 * PrintExecuteîç¼æ´çéå £ççæ æ¤) *
 * @param results - Executeîç¼æ´çArray
 */
export function debugPrintResults(results: HookExecutionResult[]) {
  console.log('\n===== Execution Results =====');
  results.forEach((result, index) => {
    console.log(`\nResult ${index + 1}:`);
    console.log(`  Plugin: ${result.pluginId}`);
    console.log(`  Success: ${result.success}`);
    console.log(`  Duration: ${result.duration}ms`);
    if (result.data) {
      console.log(`  Data:`, result.data);
    }
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  });
  console.log('\n=============================\n');
}

/**
 * PrintMockçåªæ¤Informationéå £ççæ æ¤) *
 * @param mockFn - MockFunction
 * @param name - FunctionName
 */
export function debugPrintMockCalls(mockFn: ReturnType<typeof vi.fn>, name: string = 'Handler') {
  console.log(`\n===== ${name} Mock Calls =====`);
  console.log(`Total calls: ${mockFn.mock.calls.length}`);

  mockFn.mock.calls.forEach((call: unknown[], index: number) => {
    console.log(`\nCall ${index + 1}:`);
    console.log(`  Arguments:`, call);
  });

  console.log('\n===============================\n');
}
