/**
 * Slot Policy
 *
 * Risk-based governance for plugin UI slot registrations.
 *
 * Slot trust levels:
 * - content: Normal content slots (header, footer, site pages, sidebar)
 * - dashboard: Dashboard-specific slots (require auth context)
 * - head: head:meta, head:scripts - must go through HeadTag policy
 * - body: body:start, body:end - high privilege, trusted plugins only
 *
 * Runtime trust level comes from plugin.ts contracts.
 */

import { logger } from '@/lib/_core/logger';
import type { PluginTrustLevel } from '@ploykit/plugin-sdk';
import { isPluginRouteSlotName } from '@ploykit/plugin-sdk';
import type { PluginRuntimeContract } from '@/lib/plugin-runtime/contract';
import type { SlotName, SlotRegistration } from './types';

export type SlotTrustLevel = 'content' | 'dashboard' | 'head' | 'body';
export type SlotPluginTrustLevel = PluginTrustLevel;

/**
 * Map slot names to their trust levels
 */
export function getSlotTrustLevel(slotName: SlotName): SlotTrustLevel {
  switch (slotName) {
    case 'head:meta':
    case 'head:scripts':
      return 'head';

    case 'body:start':
    case 'body:end':
      return 'body';

    default:
      if (isPluginRouteSlotName(slotName)) {
        return 'content';
      }
      // All other slots are content-level
      return 'content';
  }
}

/**
 * Check if a slot requires elevated trust
 */
export function requiresElevatedTrust(slotName: SlotName): boolean {
  const level = getSlotTrustLevel(slotName);
  return level === 'head' || level === 'body';
}

/**
 * Get minimum required plugin trust level for a slot
 */
export function getRequiredPluginTrust(slotName: SlotName): 'trusted' | 'system' {
  const level = getSlotTrustLevel(slotName);

  switch (level) {
    case 'head':
    case 'body':
      return 'system'; // Only system/trusted plugins can use head/body slots
    case 'dashboard':
      return 'trusted';
    case 'content':
      return 'trusted';
  }
}

export interface SlotPolicyOptions {
  /** Plugin trust level */
  pluginTrustLevel?: SlotPluginTrustLevel;
  /** Whether to log violations instead of blocking */
  auditOnly?: boolean;
}

/**
 * Validate a slot registration against policy
 */
export function validateSlotRegistration(
  registration: SlotRegistration,
  options: SlotPolicyOptions = {}
): { allowed: boolean; reason?: string } {
  const { pluginTrustLevel = 'untrusted', auditOnly = false } = options;
  const slotName = registration.slotName;
  const requiredTrust = getRequiredPluginTrust(slotName);

  // Map plugin trust levels to numeric values for comparison
  const trustValues: Record<string, number> = {
    untrusted: 0,
    trusted: 1,
    system: 2,
  };

  const pluginTrustValue = trustValues[pluginTrustLevel] ?? 0;
  const requiredTrustValue = trustValues[requiredTrust] ?? 1;

  if (pluginTrustValue < requiredTrustValue) {
    const reason = `Slot "${slotName}" requires ${requiredTrust} trust level, but plugin "${registration.pluginId}" has ${pluginTrustLevel}`;
    logger.warn(
      { slotName, pluginId: registration.pluginId, requiredTrust, pluginTrustLevel },
      'Slot registration blocked by policy'
    );
    return { allowed: auditOnly, reason };
  }

  return { allowed: true };
}

/**
 * Filter slot registrations by policy
 *
 * @returns Allowed registrations and blocked registrations with reasons
 */
export function filterSlotsByPolicy(
  registrations: SlotRegistration[],
  options: SlotPolicyOptions = {}
): {
  allowed: SlotRegistration[];
  blocked: Array<{ registration: SlotRegistration; reason: string }>;
} {
  const allowed: SlotRegistration[] = [];
  const blocked: Array<{ registration: SlotRegistration; reason: string }> = [];

  for (const registration of registrations) {
    const result = validateSlotRegistration(registration, options);
    if (result.allowed) {
      allowed.push(registration);
    } else {
      blocked.push({ registration, reason: result.reason || 'policy violation' });
    }
  }

  if (blocked.length > 0) {
    logger.info({ allowed: allowed.length, blocked: blocked.length }, 'Slot policy filter applied');
  }

  return { allowed, blocked };
}

/**
 * Get plugin trust level for slot policy checks.
 */
export function getPluginTrustLevelForSlots(
  contractOrPluginId: Pick<PluginRuntimeContract, 'trustLevel'> | string
): SlotPluginTrustLevel {
  if (typeof contractOrPluginId === 'object') {
    return contractOrPluginId.trustLevel || 'untrusted';
  }

  return 'untrusted';
}
