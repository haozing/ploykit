/**
 *
 */

import { radiusTokens } from './tokens/radius';
import { shadowTokens } from './tokens/shadows';
import { fontSizeTokens, fontWeightTokens, lineHeightTokens } from './tokens/typography';
import { durationTokens, easingTokens } from './tokens/animation';

/**
 * GlobalDefaultValue
 */
export const GLOBAL_DEFAULTS = {
  borderRadius: radiusTokens.lg, // 12px
  borderRadiusLarge: radiusTokens.xl, // 16px
  borderRadiusSmall: radiusTokens.md, // 8px

  fontSize: fontSizeTokens.base, // 16px
  fontWeight: fontWeightTokens.normal, // 400
  lineHeight: lineHeightTokens.normal, // 1.5

  transitionDuration: durationTokens[150], // 150ms
  transitionEasing: easingTokens.out, // ease-out

  shadow: shadowTokens.sm, //

  spacing: '1rem', // 16px
  spacingLarge: '1.5rem', // 24px
  spacingSmall: '0.5rem', // 8px
} as const;
