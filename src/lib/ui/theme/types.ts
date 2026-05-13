/**
 * ==========================================================================
 * Theme System Type Definitions
 * ==========================================================================
 *
 * Core types for the theming system:
 * - Layout configuration (shell/frameless modes)
 * - Design tokens (colors, spacing, typography)
 * - Page layout configuration
 */

/**
 * Layout mode
 *
 * - shell: Standard layout with Header + Main + Footer
 * - frameless: No header/footer, full page content
 */
export type _LayoutMode = 'shell' | 'frameless';
export type LayoutMode = _LayoutMode;

/**
 * Container mode
 *
 * - fixed: Fixed-width container (max-width constrained)
 * - fluid: Full-width container (100% width)
 * - none: No container wrapper
 */
export type _Container = 'fixed' | 'fluid' | 'none';
export type Container = _Container;

/**
 * Color mode for theme switching
 */
export type ColorMode = 'light' | 'dark' | 'system';

/**
 * Header visual variant
 */
export type HeaderVariant = 'minimal' | 'glass' | 'solid' | 'transparent';

/**
 * Theme design tokens
 *
 * These tokens are converted to CSS variables for use in components.
 *
 * @example
 * ```css
 * .my-component {
 *   background-color: var(--header-bg);
 *   color: var(--header-text);
 * }
 * ```
 */
export interface ThemeTokens {
  /** Common tokens */
  common: {
    /** Font family */
    fontFamily: string;
    /** Background color */
    colorBg: string;
    /** Text color */
    colorText: string;
    /** Primary color */
    colorPrimary: string;
    /** Primary text color (text on primary background) */
    colorPrimaryText: string;
    /** Border radius */
    radius: string;
    /** Box shadow */
    shadow: string;
    /** Container max width */
    containerMaxW: string;
    /** Color mode */
    mode: ColorMode;
  };

  /** Header tokens */
  header: {
    /** Height */
    height: string;
    /** Background color */
    bg: string;
    /** Text color */
    text: string;
    /** Bottom border */
    borderBottom?: string;
    /** Visual variant */
    variant: HeaderVariant;
    /** Sticky positioning */
    sticky?: boolean;
    /** Horizontal padding */
    paddingX?: string;
    /** Vertical padding */
    paddingY?: string;
  };

  /** Footer tokens */
  footer: {
    /** Background color */
    bg: string;
    /** Text color */
    text: string;
    /** Top border */
    borderTop?: string;
    /** Vertical padding */
    paddingY: string;
    /** Horizontal padding */
    paddingX?: string;
  };

  /** Content area tokens */
  content: {
    /** Vertical padding */
    paddingY: string;
    /** Background color */
    bg?: string;
  };
}

/**
 * Page layout configuration
 */
export interface PageLayoutConfig {
  /** Layout mode (default: "shell") */
  layout?: LayoutMode;
  /** Container mode (default: "fixed") */
  container?: Container;
  /** Hide header (default: false) */
  hideHeader?: boolean;
  /** Hide footer (default: false) */
  hideFooter?: boolean;
}

/**
 * Layout source.
 *
 * plugin:* is reserved until the runtime contract grows explicit layout support.
 */
export type LayoutSource = 'default' | `plugin:${string}`;

/**
 * Theme source.
 *
 * plugin:* is reserved until the runtime contract grows explicit theme support.
 */
export type ThemeSource = 'default' | `plugin:${string}`;
