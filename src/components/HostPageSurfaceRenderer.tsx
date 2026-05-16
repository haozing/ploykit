import { PluginProvider } from '@ploykit/plugin-sdk/react';
import { logger } from '@/lib/_core/logger';
import {
  resolveHostPageSurface,
  type HostPageSurface,
  HostPageOverrideRegistration,
  HostPageSlotRegistration,
} from '@/lib/host-pages/surface.server';
import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import type { ComponentType, ReactNode } from 'react';

interface HostPageSlotListProps {
  slots: HostPageSlotRegistration[];
  className?: string;
  locale: string;
}

interface HostPageOverrideProps {
  override: HostPageOverrideRegistration;
  fallback?: ReactNode;
  locale: string;
}

interface HostPageSlotBoundaryProps {
  pathname: string;
  position: HostPageSlotRegistration['position'];
  className?: string;
  locale?: string;
  surface?: HostPageSurface | null;
}

export async function HostPageSlotList({ slots, className, locale }: HostPageSlotListProps) {
  const rendered = await Promise.all(
    slots.map(async (slot) => {
      try {
        const loaded = (await slot.load()) as { default?: ComponentType<{ locale: string }> };
        const Component = loaded.default;
        if (!Component) {
          throw new Error(`Missing default export for ${slot.component}`);
        }

        return (
          <PluginProvider
            key={`${slot.pluginId}:${slot.page}:${slot.position}:${slot.component}`}
            pluginId={slot.pluginId}
          >
            <Component locale={locale} />
          </PluginProvider>
        );
      } catch (error) {
        logger.error(
          { error, pluginId: slot.pluginId, page: slot.page, component: slot.component },
          'Failed to render host page slot'
        );
        return null;
      }
    })
  );

  const valid = rendered.filter(Boolean);
  if (valid.length === 0) {
    return null;
  }

  return className ? <div className={className}>{valid}</div> : <>{valid}</>;
}

export async function HostPageOverride({
  override,
  fallback = null,
  locale,
}: HostPageOverrideProps) {
  let loaded: { default?: ComponentType<PluginRuntimePageProps> };

  try {
    loaded = (await override.load()) as { default?: ComponentType<PluginRuntimePageProps> };
  } catch (error) {
    logger.error(
      {
        error,
        pluginId: override.pluginId,
        page: override.page,
        component: override.component,
      },
      'Failed to load host page override'
    );
    return fallback;
  }

  const Component = loaded.default;
  if (!Component) {
    logger.error(
      {
        pluginId: override.pluginId,
        page: override.page,
        component: override.component,
      },
      'Host page override component missing default export'
    );
    return fallback;
  }

  return (
    <PluginProvider pluginId={override.pluginId}>
      <Component
        pluginId={override.pluginId}
        localPath={override.page}
        requestPath={override.page}
        locale={locale}
        params={{}}
        query={{}}
        assets={{}}
        route={{
          path: override.page,
          auth: 'public',
          layout: 'site',
          permissions: [],
          publicAliases: [],
        }}
      />
    </PluginProvider>
  );
}

export async function HostPageSlotBoundary({
  pathname,
  position,
  className,
  locale = 'en',
  surface,
}: HostPageSlotBoundaryProps) {
  const resolvedSurface = surface ?? (await resolveHostPageSurface(pathname));
  const slots = resolvedSurface?.slots.filter((slot) => slot.position === position) ?? [];

  return <HostPageSlotList slots={slots} locale={locale} className={className} />;
}
