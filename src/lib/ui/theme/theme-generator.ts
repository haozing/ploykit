/**
 * ════════════════════════════════════════════════════════════
 * Theme Generator - Generate theme CSS from user configuration
 * ════════════════════════════════════════════════════════════
 */

import type { UserThemeConfig } from '@/theme.config';
import { extractThemeFromHex } from './color-converter';
import { generateColorScale } from './color-system';
import { getPreset } from './presets';
import { oklchToHex } from './color-converter';

/**
 * Generate theme CSS variables from user configuration
 */
export function generateThemeCSS(config: UserThemeConfig) {
  // 1. Parse user configuration
  let hue: number, chroma: number, lightness: number;

  if (config.preset) {
    const preset = getPreset(config.preset);
    if (preset) {
      hue = preset.hue;
      chroma = preset.chroma;
      lightness = preset.lightness;
    } else {
      // Default to Indigo
      const defaultPreset = getPreset('indigo')!;
      hue = defaultPreset.hue;
      chroma = defaultPreset.chroma;
      lightness = defaultPreset.lightness;
    }
  } else if (config.primaryColor) {
    const extracted = extractThemeFromHex(config.primaryColor);
    hue = extracted.primaryHue;
    chroma = extracted.primaryChroma;
    lightness = extracted.primaryLightness;
  } else if (config.manual) {
    hue = config.manual.primaryHue;
    chroma = config.manual.primaryChroma;
    lightness = config.manual.primaryLightness;
  } else {
    // Default to Indigo
    const defaultPreset = getPreset('indigo')!;
    hue = defaultPreset.hue;
    chroma = defaultPreset.chroma;
    lightness = defaultPreset.lightness;
  }

  // 2. Generate color scale
  const colorScale = generateColorScale(hue, chroma, lightness);

  // 3. Convert to HEX (for globals.css)
  const scaleHex: Record<number, string> = {};
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].forEach((shade) => {
    const oklchColor = colorScale[shade as keyof typeof colorScale];
    // Parse oklch(66% 0.21 260) format
    const match = oklchColor.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/);
    if (match) {
      const l = parseFloat(match[1]);
      const c = parseFloat(match[2]);
      const h = parseFloat(match[3]);
      scaleHex[shade] = oklchToHex(l, c, h);
    }
  });

  // 4. Generate CSS variable string
  const lightModeCSS = `
    --dynamic-primary-50: ${scaleHex[50]};
    --dynamic-primary-100: ${scaleHex[100]};
    --dynamic-primary-200: ${scaleHex[200]};
    --dynamic-primary-300: ${scaleHex[300]};
    --dynamic-primary-400: ${scaleHex[400]};
    --dynamic-primary-500: ${scaleHex[500]};
    --dynamic-primary-600: ${scaleHex[600]};
    --dynamic-primary-700: ${scaleHex[700]};
    --dynamic-primary-800: ${scaleHex[800]};
    --dynamic-primary-900: ${scaleHex[900]};
  `.trim();

  return {
    light: lightModeCSS,
    dark: lightModeCSS, // Dark mode uses the same color scale
  };
}
