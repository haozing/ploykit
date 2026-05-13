/**
 * Plugin Hooks System
 *
 * Unified hook registration and execution for plugins.
 */

// Core System
export { UnifiedHookSystem, unifiedHookSystem } from './unified-system';
export { HookContextBuilder } from './context';

// Constants
export {
  LIFECYCLE_HOOKS,
  REQUEST_HOOKS,
  RENDER_HOOKS,
  EVENT_HOOKS,
  ALL_HOOK_NAMES,
  HOOK_TYPE_MAP,
  DEFAULT_HOOK_TIMEOUT,
  getHookType,
} from './constants';

// Type Definitions
export type {
  AllHookName,
  LifecycleHookName,
  RequestHookName,
  RenderHookName,
  EventHookName,
  HookExecutionContext,
  HookHandler,
  TypedHookHandler,
  HookPayloadMap,
  HookRegistration,
  HookExecutionResult,
  HookExecutionOptions,
} from './types';
