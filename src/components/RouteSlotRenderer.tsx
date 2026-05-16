import { slotManager } from '@/lib/ui/slots/slot-manager';
import { logger } from '@/lib/_core/logger';
import type { PluginRouteSlotPosition } from '@ploykit/plugin-sdk';
import type { SlotMode } from '@/lib/ui/slots/types';
import type { ReactElement, ReactNode } from 'react';

export interface RouteSlotRendererProps {
  pathname: string;
  position: PluginRouteSlotPosition;
  mode?: SlotMode;
  fallback?: ReactNode;
  className?: string;
  locale?: string;
}

export async function RouteSlotRenderer({
  pathname,
  position,
  mode = 'append',
  fallback = null,
  className,
  locale = 'en',
}: RouteSlotRendererProps): Promise<ReactElement> {
  let components: ReactNode[] = [];
  let hasError = false;

  try {
    components = await slotManager.renderRouteSlot(pathname, position, mode, { locale });
  } catch (error) {
    logger.error({ error, pathname, position }, 'Failed to render route slot');
    hasError = true;
  }

  const shouldShowFallback = hasError || components.length === 0;
  const content: ReactNode = shouldShowFallback ? fallback : components;

  if (!content) {
    return <></>;
  }

  if (className) {
    return <div className={className}>{content}</div>;
  }

  return <>{content}</>;
}
