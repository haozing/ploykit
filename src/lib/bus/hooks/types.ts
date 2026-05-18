/**
 * Hooks system core type definitions - Refactored version
 *
 * Adopts industry best practices:
 * - Unified context object signature
 * - Complete type safety
 * - Clear payload mapping
 */

import type { PluginContext } from '@ploykit/plugin-sdk';

//
// Hook categories - Grouped by execution timing and purpose
//

/**
 * Lifecycle hooks - Triggered during plugin install/enable/disable
 */
export type LifecycleHookName =
  | 'onInstall'
  | 'onEnable'
  | 'onDisable'
  | 'onUninstall'
  | 'onUpgrade';

/**
 * Request hooks - Triggered during HTTP request processing
 */
export type RequestHookName =
  | 'onRouteResolve' // Route resolution
  | 'onBeforeHandle' // Before request processing
  | 'onAfterHandle'; // After request processing

/**
 * Render hooks - Triggered during page rendering
 */
export type RenderHookName =
  | 'onRenderHead' // Inject into <head>
  | 'onSitemap'; // Generate sitemap

/**
 * Event hooks - Custom events
 */
export type EventHookName = 'onEvent';

/**
 * All hook types
 */
export type AllHookName = LifecycleHookName | RequestHookName | RenderHookName | EventHookName;

//
// Hook execution context - Core with unified signature
//

/**
 * Hook execution context
 *
 * Best practice: All hooks use the same signature
 *
 * Contains all information needed for hook execution:
 * - plugin: Plugin capability access (DI container injection)
 * - hook: Hook metadata (name, type, trigger location)
 * - environment: Execution environment (user, request ID, etc.)
 * - payload: Hook-specific data (type-safe)
 * - metadata: Extension metadata
 *
 * @template TPayload - Hook-specific data type
 */
export interface HookExecutionContext<TPayload = unknown> {
  /**
   * Plugin capability access
   *
   * Provides complete DI capabilities for plugins, including:
   * - Database access (plugin.db)
   * - Event publish/subscribe (plugin.events)
   * - Service invocation (ctx.services)
   * - Logging (plugin.logger)
   * - Configuration access (plugin.config)
   *
   * All hooks can access complete capabilities
   */
  plugin: PluginContext;

  /**
   * Hook metadata
   */
  hook: {
    /** Hook name */
    name: AllHookName;

    /** Hook type */
    type: 'lifecycle' | 'request' | 'render' | 'event';

    /** Trigger location */
    trigger: string;
  };

  /**
   * Execution environment information
   */
  environment: {
    /** User ID (optional) */
    userId?: string;

    /** Request ID (for log tracing) */
    requestId?: string;

    /** Timestamp */
    timestamp: Date;
  };

  /**
   * Hook-specific payload data
   *
   * Different hooks have different payload types, specified via generic parameter
   *
   * @example
   * ```typescript
   * // onRenderHead context
   * context: HookExecutionContext<{ url: string; pathname: string }>
   *
   * // onInstall context
   * context: HookExecutionContext<{ config?: unknown; installedBy?: string }>
   * ```
   */
  payload?: TPayload;

  /**
   * Extension metadata (optional)
   *
   * Used to pass framework-level extra information without breaking existing hook signatures
   *
   * Use cases:
   * - Debug information (trace ID, span ID)
   * - Framework internal flags (feature flags)
   * - Performance analysis data
   * - Experimental feature parameters
   *
   * Note:
   * - metadata is for framework-level data, payload is for hook-specific business data
   * - Plugin developers typically don't need to use metadata directly
   * - metadata doesn't affect core hook logic
   *
   * @example
   * ```typescript
   * // Add trace information
   * context.metadata = {
   *   traceId: 'abc-123',
   *   spanId: 'span-456',
   *   experimentalFeature: true,
   * };
   * ```
   */
  metadata?: Record<string, unknown>;
}

//
// Hook handler - Unified signature
//

/**
 * Hook handler function type
 *
 * Best practice: Single, clear signature
 *
 * All hooks use the same signature:
 * - Single parameter: context
 * - Generic support: TPayload and TResult for type safety
 * - Async support: Returns promise
 * - Runtime agnostic: No need for runtime detection
 *
 * @template TPayload - Hook-specific input data type
 * @template TResult - Hook return value type
 *
 * @param context - Hook execution context containing all needed information
 * @returns Hook return value (optional)
 *
 * @example
 * ```typescript
 * // Implementing a hook handler
 * const onRenderHead: HookHandler<RenderHeadPayload, HeadTag[]> = async (context) => {
 *   const { plugin, environment, payload } = context;
 *
 *   // Use plugin capabilities
 *   plugin.logger.info({ url: payload?.url }, 'Rendering head');
 *
 *   // Return result
 *   return [{ tag: 'meta', attrs: { ... } }];
 * };
 * ```
 */
export type HookHandler<TPayload = unknown, TResult = unknown> = (
  context: HookExecutionContext<TPayload>
) => TResult | Promise<TResult>;

//
// Hook payload type mapping
//

/**
 * Hook payload type mapping
 *
 * Best practice: Each hook has a well-defined payload type
 *
 * Provides complete type safety and IDE autocomplete
 */
export interface HookPayloadMap {
  //
  // Lifecycle hooks
  //

  /** Plugin installation */
  onInstall: {
    config?: unknown;
    installedBy?: string;
  };

  /** Plugin enabling */
  onEnable: {
    previouslyEnabled: boolean;
  };

  /** Plugin disabling */
  onDisable: void;

  /** Plugin uninstallation */
  onUninstall: void;

  /** Plugin upgrade */
  onUpgrade: {
    fromVersion: string;
    toVersion: string;
  };

  //
  // Request hooks
  //

  /** Before request processing */
  onBeforeHandle: {
    request: Request;
    route: {
      path: string;
      method: string;
    };
  };

  /** After request processing */
  onAfterHandle: {
    request: Request;
    response: Response;
    duration: number;
  };

  /** Route resolution */
  onRouteResolve: {
    pathname: string;
    method: string;
  };

  //
  // Render hooks
  //

  /** Render <head> */
  onRenderHead: {
    url: string;
    pathname: string;
  };

  /** Generate sitemap */
  onSitemap: {
    baseUrl: string;
  };

  //
  // Event hooks
  //

  /** Custom event */
  onEvent: {
    event: string;
    data: unknown;
  };
}

/**
 * Type-safe hook handler
 *
 * Best practice: Automatically infer payload type
 *
 * @template H - Hook name
 *
 * @example
 * ```typescript
 * // TypeScript automatically infers payload type
 * export const onRenderHead: TypedHookHandler<'onRenderHead'> = async (context) => {
 *   const url = context.payload?.url;  // Type: string | undefined
 *   //              ^^^^^^^ IDE provides complete hints
 * };
 * ```
 */
export type TypedHookHandler<H extends AllHookName> = HookHandler<HookPayloadMap[H], unknown>;

//
// Hook registration and execution results
//

/**
 * Hook registration information
 *
 * Simplified: Unified registration structure
 */
export interface HookRegistration {
  /** Plugin ID */
  pluginId: string;

  /** Hook name */
  hookName: AllHookName;

  /**
   * Concrete hook handler.
   *
   * Lazy hook loading is intentionally unsupported for runtime contracts.
   * Register executable handlers directly.
   */
  handler: HookHandler;

  /** Priority (lower number = execute first) */
  priority: number;

  /** Registration timestamp */
  registeredAt: Date;
}

/**
 * Hook execution result
 */
export interface HookExecutionResult<T = unknown> {
  /** Is successful */
  success: boolean;

  /** Plugin ID */
  pluginId: string;

  /** Return data */
  data?: T;

  /** Error message */
  error?: string;

  /** Execution duration (milliseconds) */
  duration: number;

  /** Execution timestamp */
  executedAt: Date;
}

/**
 * Hook execution options.
 */
export interface HookExecutionOptions {
  /** Restrict execution to a known set of enabled plugins. */
  pluginIds?: readonly string[] | undefined;

  /** Override timeout for tests or explicitly constrained hook points. */
  timeoutMs?: number | undefined;
}
