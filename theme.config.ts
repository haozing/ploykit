/**
 * ════════════════════════════════════════════════════════════
 * Theme Configuration v3.0 - Complete Design System
 * ════════════════════════════════════════════════════════════
 *
 * This is the site's theme configuration with a complete design token system
 *
 * 💡 Two color scheme methods:
 * 1. HEX mode (recommended) - Directly use HEX color values, e.g., '#6366f1'
 * 2. Manual mode - Manually configure hue/saturation/lightness parameters
 *
 * These tokens will be converted to CSS variables injected into the page:
 * --header-bg, --header-text, --color-primary, etc.
 */

import type { ThemeTokens } from '@/lib/ui/theme/types';
import type { SlotName } from '@/lib/ui/slots/types';
import { extractThemeFromHex } from '@/lib/ui/theme/color-converter';
import { generateThemeColors } from '@/lib/ui/theme/color-system';
import { GLOBAL_DEFAULTS } from '@/lib/ui/theme/defaults';

/**
 * ════════════════════════════════════════════════════════════
 * 🆕 User Theme Configuration Interface
 * ════════════════════════════════════════════════════════════
 */
export interface UserThemeConfig {
  // Visual theme configuration
  preset?:
    | 'indigo'
    | 'violet'
    | 'purple'
    | 'blue'
    | 'sky'
    | 'cyan'
    | 'emerald'
    | 'teal'
    | 'rose'
    | 'pink'
    | 'orange'
    | 'amber';
  primaryColor?: string; // HEX color
  manual?: {
    primaryHue: number;
    primaryChroma: number;
    primaryLightness: number;
  };

  // Advanced overrides
  overrides?: {
    header?: Partial<ThemeTokens['header']>;
    footer?: Partial<ThemeTokens['footer']>;
    common?: Partial<ThemeTokens['common']>;
  };

  // 🆕 Slot configuration (part of theme)
  slots?: {
    // Enable/disable specific slots
    disabled?: SlotName[];

    // Slot style configuration
    styles?: Partial<
      Record<
        SlotName,
        {
          className?: string;
          maxItems?: number; // Limit max number of hooks in this slot
        }
      >
    >;
  };
}

/**
 * ════════════════════════════════════════════════════════════
 * 🆕 User Theme Configuration (users modify here)
 * ════════════════════════════════════════════════════════════
 */
export const userThemeConfig: UserThemeConfig = {
  // Theme color (users only need to modify here)
  preset: 'indigo',

  // Or use HEX color
  // primaryColor: '#6366f1',

  // Advanced configuration
  overrides: {
    header: {
      height: '64px',
      variant: 'solid',
    },
  },

  // Slot configuration
  slots: {
    // Disable certain slots (example)
    disabled: [
      // 'sidebar:right', // Uncomment to disable
    ],

    // Slot styles
    styles: {
      'header:actions-before': {
        className: 'flex items-center gap-2',
        maxItems: 3,
      },
    },
  },
};

/**
 * ════════════════════════════════════════════════════════════
 * Color Scheme Selection
 * ════════════════════════════════════════════════════════════
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎨 Method 1: HEX Mode (Recommended - Most Intuitive)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const THEME_CORE_HEX = {
  primaryColor: '#6366f1', // Indigo (Scheme 2) ⭐

  // 🎨 Other color examples (uncomment to use):
  // primaryColor: '#a855f7',  // Violet
  // primaryColor: '#8b5cf6',  // Light Purple
  // primaryColor: '#0ea5e9',  // Sky Blue
  // primaryColor: '#06b6d4',  // Cyan
  // primaryColor: '#3b82f6',  // Blue
  // primaryColor: '#ec4899',  // Pink
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎨 Method 2: Manual Mode (Advanced - More Flexible)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const THEME_CORE_MANUAL = {
  primaryHue: 260, // Hue (0-360)
  primaryChroma: 0.21, // Chroma (0-0.4)
  primaryLightness: 66, // Lightness (0-100)
};

/**
 * ════════════════════════════════════════════════════════════
 * Mode Selection
 * ════════════════════════════════════════════════════════════
 */

// 🎯 Configuration mode: 'hex' | 'manual'
const CONFIG_MODE: 'hex' | 'manual' = 'hex'; // ⬅️ Change here to switch mode

/**
 * ════════════════════════════════════════════════════════════
 * Deferred Calculation Functions (avoid running culori during module load)
 * ════════════════════════════════════════════════════════════
 */

// Calculate theme core parameters (deferred execution)
function computeThemeCore() {
  if (CONFIG_MODE === 'hex') {
    return extractThemeFromHex(THEME_CORE_HEX.primaryColor);
  }
  return THEME_CORE_MANUAL;
}

// Calculate theme colors (deferred execution)
function computeThemeColors() {
  const core = getThemeCore();
  return generateThemeColors(core.primaryHue, core.primaryChroma, core.primaryLightness);
}

// Cache variables (singleton pattern)
let cachedThemeCore: ReturnType<typeof computeThemeCore> | null = null;
let cachedThemeColors: ReturnType<typeof computeThemeColors> | null = null;

/**
 * Get theme core parameters (with cache)
 */
export function getThemeCore() {
  if (!cachedThemeCore) {
    cachedThemeCore = computeThemeCore();
  }
  return cachedThemeCore;
}

/**
 * Get theme colors (with cache)
 */
export function getThemeColors() {
  if (!cachedThemeColors) {
    cachedThemeColors = computeThemeColors();
  }
  return cachedThemeColors;
}

/**
 * ════════════════════════════════════════════════════════════
 * Theme Core Exports
 * ════════════════════════════════════════════════════════════
 *
 * Use getter functions to avoid side effects during module loading:
 * - getThemeCore() - Get theme core parameters
 * - getThemeColors() - Get theme color object
 */

/**
 * ════════════════════════════════════════════════════════════
 * Theme Token Generation Functions (Lazy Initialization)
 * ════════════════════════════════════════════════════════════
 */

// Cache variables
let cachedThemeTokens: ThemeTokens | null = null;
let cachedDarkThemeTokens: ThemeTokens | null = null;

/**
 * Get default theme (light)
 */
export function getThemeTokens(): ThemeTokens {
  if (!cachedThemeTokens) {
    const colors = getThemeColors();
    cachedThemeTokens = {
      common: {
        fontFamily: 'var(--font-geist-sans)',
        colorBg: '#ffffff',
        colorText: '#0a0a0a',
        colorPrimary: colors.primary.DEFAULT,
        colorPrimaryText: '#ffffff',
        radius: GLOBAL_DEFAULTS.borderRadius,
        shadow: GLOBAL_DEFAULTS.shadow,
        containerMaxW: '1200px',
        mode: 'light',
      },
      header: {
        height: '64px',
        bg: '#ffffff',
        text: '#0a0a0a',
        borderBottom: '1px solid #e5e5e5',
        variant: 'solid',
        paddingX: '24px',
        paddingY: '12px',
      },
      footer: {
        bg: '#f5f5f5',
        text: '#525252',
        borderTop: '1px solid #e5e5e5',
        paddingY: '48px',
        paddingX: '24px',
      },
      content: {
        paddingY: '48px',
        bg: '#ffffff',
      },
    };
  }
  return cachedThemeTokens;
}

/**
 * Get dark theme
 */
export function getDarkThemeTokens(): ThemeTokens {
  if (!cachedDarkThemeTokens) {
    const colors = getThemeColors();
    const core = getThemeCore();
    cachedDarkThemeTokens = {
      common: {
        fontFamily: 'var(--font-geist-sans)',
        colorBg: '#0a0a0a',
        colorText: '#ffffff',
        colorPrimary: colors.primary[400],
        colorPrimaryText: '#ffffff',
        radius: GLOBAL_DEFAULTS.borderRadius,
        shadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        containerMaxW: '1200px',
        mode: 'dark',
      },
      header: {
        height: '64px',
        bg: `oklch(15% 0.02 ${core.primaryHue})`,
        text: '#ffffff',
        borderBottom: '1px solid #2a2a2a',
        variant: 'solid',
        paddingX: '24px',
        paddingY: '12px',
      },
      footer: {
        bg: '#0a0a0a',
        text: '#999999',
        borderTop: '1px solid #2a2a2a',
        paddingY: '48px',
        paddingX: '24px',
      },
      content: {
        paddingY: '48px',
        bg: '#0a0a0a',
      },
    };
  }
  return cachedDarkThemeTokens;
}

/**
 * Theme Token Exports
 *
 * Use getter functions:
 * - getThemeTokens() - Get light theme tokens
 * - getDarkThemeTokens() - Get dark theme tokens
 */

/**
 * ════════════════════════════════════════════════════════════
 * Export Design Tokens (for use by other modules)
 * ════════════════════════════════════════════════════════════
 */
export { GLOBAL_DEFAULTS as designDefaults } from '@/lib/ui/theme/defaults';
export { designTokens } from '@/lib/ui/theme/tokens';
