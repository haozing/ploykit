/**
 * Slot system type definitions.
 *
 * Slots are host-owned placeholders where trusted plugins can render UI
 * components at specific positions.
 */

import {
  PLUGIN_SLOT_NAMES,
  VALID_PLUGIN_SLOT_NAMES,
  isValidPluginSlotName,
  type PluginSlotName,
  type PluginSlotsDefinition,
} from '@ploykit/plugin-sdk';

/**
 * Slot rendering mode.
 *
 * - replace: only render the highest priority component
 * - append: render all enabled components in priority order
 */
export type SlotMode = 'replace' | 'append';

export type SlotName = PluginSlotName;

export const SLOT_NAMES = PLUGIN_SLOT_NAMES;
export const VALID_SLOT_NAMES: ReadonlySet<string> = VALID_PLUGIN_SLOT_NAMES;

/**
 * Runtime validation for slot names.
 */
export function isValidSlotName(name: string): name is SlotName {
  return isValidPluginSlotName(name);
}

/**
 * Slot registration information.
 */
export interface SlotRegistration {
  /** Plugin ID */
  pluginId: string;

  /** Slot name */
  slotName: SlotName;

  /** Component path, relative to the plugin directory */
  componentPath: string;

  /** Priority, lower number renders first */
  priority: number;

  /** Whether this registration is enabled */
  enabled: boolean;

  /** Registration timestamp */
  registeredAt: Date;
}

export type SlotConfig = PluginSlotsDefinition;
