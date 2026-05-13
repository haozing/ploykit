/**
 * OKLCH Color Scale Generator
 *
 * Generates a complete color scale (50-900) from a base color using OKLCH color space.
 */

export interface ColorScale {
  50: string; // Lightest
  100: string; // Very light
  200: string; // Light
  300: string; // Light medium
  400: string; // Medium (actions/hover)
  500: string; // Base color
  600: string; // Medium dark
  700: string; // Dark
  800: string; // Very dark
  900: string; // Darkest
  DEFAULT: string; // Default (same as 500)
  foreground: string; // Text on primary background
}

/**
 * Generate a color scale from base OKLCH values
 * @param hue - Hue angle (0-360)
 * @param baseChroma - Base chroma value (0-0.4)
 * @param baseLightness - Base lightness value (0-100)
 */
export function generateColorScale(
  hue: number,
  baseChroma: number,
  baseLightness: number
): ColorScale {
  // Lightness mapping for each shade
  const lightnessMap = {
    50: baseLightness + 31, // ~97%
    100: baseLightness + 27, // ~93%
    200: baseLightness + 22, // ~88%
    300: baseLightness + 16, // ~82%
    400: baseLightness + 7, // ~73%
    500: baseLightness, // Base (66%)
    600: baseLightness - 8, // ~58%
    700: baseLightness - 16, // ~50%
    800: baseLightness - 24, // ~42%
    900: baseLightness - 33, // ~33%
  };

  // Chroma mapping for each shade
  const chromaMap = {
    50: baseChroma * 0.19, // ~0.04
    100: baseChroma * 0.33, // ~0.07
    200: baseChroma * 0.52, // ~0.11
    300: baseChroma * 0.71, // ~0.15
    400: baseChroma * 0.9, // ~0.19
    500: baseChroma, // Base (0.21)
    600: baseChroma * 1.05, // ~0.22
    700: baseChroma * 0.95, // ~0.20
    800: baseChroma * 0.81, // ~0.17
    900: baseChroma * 0.62, // ~0.13
  };

  const scale: Partial<ColorScale> = {};

  // Generate OKLCH color for each shade
  type ScaleKey = keyof typeof lightnessMap;
  const keys = Object.keys(lightnessMap).map(Number) as ScaleKey[];

  keys.forEach((key) => {
    const l = lightnessMap[key];
    const c = chromaMap[key];
    scale[key] = `oklch(${l}% ${c.toFixed(3)} ${hue})`;
  });

  return {
    ...scale,
    DEFAULT: scale[500]!,
    foreground: 'oklch(98% 0 0)', // White text for contrast
  } as ColorScale;
}

/**
 * Generate theme colors object (compatible with Tailwind)
 */
export function generateThemeColors(hue: number, chroma: number, lightness: number) {
  const scale = generateColorScale(hue, chroma, lightness);

  return {
    primary: {
      ...scale,
    },
  };
}
