/**
 * ============================================================================
 * Slot Renderer
 * ============================================================================
 *
 * Responsible for rendering components registered in slots
 *
 * Features:
 * - Supports replace/append rendering modes
 * - Supports fallback (content displayed when no slot is registered)
 * - Server-side component (SSR friendly)
 * - Automatically handles component loading and errors
 *
 * @example
 * ```tsx
 * // Header Logo slot (replace mode)
 * <SlotRenderer slotName="header:logo" mode="replace">
 *   <DefaultLogo />
 * </SlotRenderer>
 *
 * // Header Extra slot (append mode)
 * <SlotRenderer slotName="header:extra" mode="append" />
 * ```
 */

import { slotManager } from '@/lib/ui/slots/slot-manager';
import type { SlotName, SlotMode } from '@/lib/ui/slots/types';
import { logger } from '@/lib/_core/logger';
import type { ReactNode, ReactElement } from 'react';

/**
 * ============================================================================
 * SlotRenderer Props
 * ============================================================================
 */
export interface SlotRendererProps {
  /** Slot name */
  slotName: SlotName;

  /** Rendering mode */
  mode?: SlotMode;

  /**
   * Fallback Content
   * Displayed when no plugin has registered this slot
   */
  fallback?: ReactNode;

  /**
   * CSS class name for the wrapper container (optional)
   */
  className?: string;

  /** Active locale passed to plugin-rendered slot components */
  locale?: string;
}

/**
 * ============================================================================
 * SlotRenderer Component
 * ============================================================================
 *
 * This is a Server Component that executes during server-side rendering
 */
export async function SlotRenderer({
  slotName,
  mode = 'append',
  fallback = null,
  className,
  locale = 'en',
}: SlotRendererProps): Promise<ReactElement> {
  // Log component invocation
  logger.debug(
    { slotName, mode, hasFallback: !!fallback, className },
    'SlotRenderer: Starting to render'
  );

  // Fetch slot components (separate data fetching from rendering)
  let components: ReactNode[] = [];
  let hasError = false;

  try {
    components = await slotManager.renderSlot(slotName, mode, { locale });

    logger.debug(
      {
        slotName,
        componentCount: components.length,
        willShowFallback: components.length === 0 && !!fallback,
      },
      'SlotRenderer: Render completed'
    );
  } catch (error) {
    logger.error({ error, slotName }, 'Failed to render slot');
    hasError = true;
  }

  // Determine what content to render
  const shouldShowFallback = hasError || components.length === 0;
  const content: ReactNode = shouldShowFallback ? fallback : components;

  // If no content to render, return empty fragment
  if (!content) {
    return <></>;
  }

  // If className specified, wrap content in div
  if (className) {
    return <div className={className}>{content}</div>;
  }

  // Return content wrapped in fragment
  return <>{content}</>;
}
