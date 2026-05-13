/**
 * ═══════════════════════════════════════════════════════════════
 * Site Configuration Type Definitions
 * ═══════════════════════════════════════════════════════════════
 *
 * Defines type structure for root directory configuration file (site.config.ts)
 */

import type { LayoutSource, ThemeSource, PageLayoutConfig } from '@/lib/ui/theme/types';
import type { SiteMenuItem } from '@/lib/ui/navigation/types';

// Re-export SiteMenuItem for use in site.config.ts
export type { SiteMenuItem };

/**
 * Layout Configuration
 *
 * Control which Header and Footer components to use
 */
export interface LayoutConfig {
  /**
   * Header component source
   *
   * @example
   * "default" - Use framework built-in DefaultHeader
   * "plugin:theme-dark" - Reserved for a future runtime-contract layout source
   */
  header: LayoutSource;

  /**
   * Footer component source
   *
   * @example
   * "default" - Use framework built-in DefaultFooter
   * "plugin:theme-dark" - Reserved for a future runtime-contract layout source
   */
  footer: LayoutSource;
}

/**
 * Theme Configuration
 *
 * Control which Design Tokens to use
 */
export interface ThemeConfig {
  /**
   * Design Tokens source
   *
   * @example
   * "default" - Use theme.config.ts in root directory
   * "plugin:theme-dark" - Reserved for a future runtime-contract theme source
   */
  tokens: ThemeSource;
}

/**
 * Page Configuration Mapping
 *
 * Key is page path, Value is layout configuration for that page
 */
export type PagesConfig = Record<string, PageLayoutConfig>;

/**
 * Navigation Configuration
 *
 * Control navigation menu
 */
export interface NavConfig {
  /** Navigation menu items (uses SiteMenuItem for consistency) */
  items: SiteMenuItem[];
}

/**
 * Footer Configuration
 *
 * Control Footer links
 */
export interface FooterConfig {
  /** Footer links (uses SiteMenuItem for consistency) */
  links: SiteMenuItem[];
}

/**
 * Complete Site Configuration
 *
 * This is the type definition for site.config.ts
 */
export interface SiteConfig {
  /** Site name */
  name: string;

  /** Site description */
  description: string;

  /** Layout configuration */
  layout: LayoutConfig;

  /** Navigation configuration */
  nav?: NavConfig;

  /** Footer configuration */
  footer?: FooterConfig;

  /** Theme configuration */
  theme: ThemeConfig;

  /** Page configuration */
  pages: PagesConfig;
}
