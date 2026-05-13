/**
 * ════════════════════════════════════════════════════════════
 * Slots System - Unified Exports
 * ════════════════════════════════════════════════════════════
 *
 *
 * ```typescript
 * import { slotManager, renderSlot, type SlotName } from '@/lib/ui/slots';
 * ```
 */

//
//

export { slotManager, renderSlot } from './slot-manager';

//
// Types
//

export type { SlotName, SlotMode, SlotRegistration, SlotConfig } from './types';

//
// Runtime validation
//

export { isValidSlotName, VALID_SLOT_NAMES } from './types';
