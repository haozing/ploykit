/**
 * Color Converter Utilities
 *
 * Functions:
 * 1. HEX to OKLCH conversion
 * 2. Extract hue/chroma/lightness from colors
 * 3. Generate theme parameters from HEX colors
 */

import { converter, formatHex } from 'culori';

// Color space converters
const toOklch = converter('oklch');
const toHex = converter('rgb');

/**
 * Convert HEX to OKLCH
 * @param hex - HEX color string (e.g., '#a855f7' or 'a855f7')
 * @returns OKLCH object { l, c, h }
 */
export function hexToOklch(hex: string) {
  // Ensure hex starts with #
  const normalizedHex = hex.startsWith('#') ? hex : `#${hex}`;

  const oklch = toOklch(normalizedHex);

  if (!oklch) {
    throw new Error(`Invalid HEX color: ${hex}`);
  }

  return {
    l: Math.round((oklch.l || 0) * 100), // Lightness: 0-100
    c: Number((oklch.c || 0).toFixed(3)), // Chroma: 0-0.4
    h: Math.round(oklch.h || 0), // Hue: 0-360
  };
}

/**
 * Convert OKLCH to HEX
 * @param l - Lightness (0-100)
 * @param c - Chroma (0-0.4)
 * @param h - Hue (0-360)
 * @returns HEX color string (e.g., '#a855f7')
 */
export function oklchToHex(l: number, c: number, h: number): string {
  const oklchColor = {
    mode: 'oklch' as const,
    l: l / 100, // Convert to 0-1 range
    c: c,
    h: h,
  };

  const rgb = toHex(oklchColor);
  return formatHex(rgb);
}

/**
 * Extract theme parameters from HEX color
 * @param hex - Primary HEX color (e.g., '#a855f7')
 * @returns Theme parameter object
 */
export function extractThemeFromHex(hex: string) {
  const { l, c, h } = hexToOklch(hex);

  return {
    primaryHue: h,
    primaryChroma: c,
    primaryLightness: l,
  };
}

/**
 * Validate HEX color format
 * @param hex - HEX color string to validate
 * @returns true if valid HEX format
 */
export function isValidHex(hex: string): boolean {
  const hexRegex = /^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  return hexRegex.test(hex);
}

/**
 * Usage examples:
 *
 * // 1. HEX to OKLCH
 * const { l, c, h } = hexToOklch('#a855f7');
 * // => { l: 70, c: 0.22, h: 285 }
 *
 * // 2. Extract theme parameters
 * const theme = extractThemeFromHex('#6366f1');
 * // => { primaryHue: 260, primaryChroma: 0.21, primaryLightness: 66 }
 */
