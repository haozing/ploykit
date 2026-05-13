/**
 * Hook System Constants
 *
 * Single source of truth for all hook-related constants.
 * All hook names, categories, and mappings are defined here.
 */

import type { AllHookName } from './types';

//
// Hook Name Constants by Category
//

/** Lifecycle hooks - triggered during plugin install/enable/disable */
export const LIFECYCLE_HOOKS = [
  'onInstall',
  'onEnable',
  'onDisable',
  'onUninstall',
  'onUpgrade',
] as const;

/** Request hooks - triggered during HTTP request processing */
export const REQUEST_HOOKS = ['onBeforeHandle', 'onAfterHandle', 'onRouteResolve'] as const;

/** Render hooks - triggered during page rendering */
export const RENDER_HOOKS = ['onRenderHead', 'onSitemap'] as const;

/** Event hooks - custom event handling */
export const EVENT_HOOKS = ['onEvent'] as const;

/** All valid hook names */
export const ALL_HOOK_NAMES = [
  ...LIFECYCLE_HOOKS,
  ...REQUEST_HOOKS,
  ...RENDER_HOOKS,
  ...EVENT_HOOKS,
] as const;

//
// Hook Type Mapping
//

type HookType = 'lifecycle' | 'request' | 'render' | 'event';

/** Map hook name to its type category */
export const HOOK_TYPE_MAP: Record<AllHookName, HookType> = {
  // Lifecycle
  onInstall: 'lifecycle',
  onEnable: 'lifecycle',
  onDisable: 'lifecycle',
  onUninstall: 'lifecycle',
  onUpgrade: 'lifecycle',
  // Request
  onBeforeHandle: 'request',
  onAfterHandle: 'request',
  onRouteResolve: 'request',
  // Render
  onRenderHead: 'render',
  onSitemap: 'render',
  // Event
  onEvent: 'event',
} as const;

/**
 * Get hook type for a given hook name
 *
 * @param hookName - Hook name
 * @returns Hook type category
 */
export function getHookType(hookName: AllHookName): HookType {
  return HOOK_TYPE_MAP[hookName];
}

//
// Default Values
//

/** Default timeout for hook execution in milliseconds */
export const DEFAULT_HOOK_TIMEOUT = 30000;
