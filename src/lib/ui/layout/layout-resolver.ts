/**
 * ==========================================================================
 * ==========================================================================
 *
 *
 */

import { siteConfig } from '@/site.config';
import type { LayoutSource, ThemeTokens } from '@/lib/ui/theme/types';
import { logger } from '@/lib/_core/logger';
import type { ComponentType } from 'react';

/**
 * ==========================================================================
 * Header/Footer ComponentProps Interface
 * ==========================================================================
 *
 */
export interface LayoutComponentProps {
  /** Design tokens used by layout components. */
  tokens: ThemeTokens;
}

/**
 * ==========================================================================
 * Load Header Component
 * ==========================================================================
 *
 * @returns Header Component
 */
export async function loadHeaderComponent(): Promise<ComponentType<LayoutComponentProps>> {
  const source = siteConfig.layout.header;
  return loadLayoutComponent('header', source);
}

/**
 * ==========================================================================
 * Load Footer Component
 * ==========================================================================
 *
 * @returns Footer Component
 */
export async function loadFooterComponent(): Promise<ComponentType<LayoutComponentProps>> {
  const source = siteConfig.layout.footer;
  return loadLayoutComponent('footer', source);
}

/**
 * ==========================================================================
 * ==========================================================================
 *
 * @returns LayoutComponent
 */
async function loadLayoutComponent(
  type: 'header' | 'footer',
  source: LayoutSource
): Promise<ComponentType<LayoutComponentProps>> {
  try {
    if (source === 'default') {
      logger.debug({ type }, 'Loading default layout component');
      return await loadDefaultLayoutComponent(type);
    }

    if (source.startsWith('plugin:')) {
      const pluginId = source.replace('plugin:', '');
      logger.warn(
        { type, pluginId },
        'Plugin-provided layout components are not supported by the runtime contract yet; using default layout component'
      );
      return await loadDefaultLayoutComponent(type);
    }

    logger.warn({ type, source }, 'Invalid layout source, falling back to default');
    return await loadDefaultLayoutComponent(type);
  } catch (error) {
    logger.error({ error, type, source }, 'Failed to load layout component, using default');
    return await loadDefaultLayoutComponent(type);
  }
}

/**
 * ==========================================================================
 * Load the default layout component.
 * ==========================================================================
 *
 * @param type - ComponentType
 * @returns Default component
 */
async function loadDefaultLayoutComponent(
  type: 'header' | 'footer'
): Promise<ComponentType<LayoutComponentProps>> {
  // Header/Footer
  const componentName = type.charAt(0).toUpperCase() + type.slice(1);

  const loadedModule = await import(`@/components/layouts/${type}s/Default${componentName}`);

  const Component = loadedModule.default;

  if (!Component) {
    throw new Error(`Default${componentName} doesn't have a default export`);
  }

  logger.info({ type }, 'Loaded default layout component');

  return Component;
}
