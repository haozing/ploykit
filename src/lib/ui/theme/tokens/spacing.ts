/**
 * Spacing Design Tokens
 *
 * Based on a 4px base unit, following the Tailwind spacing scale.
 *
 * Note: Uses the same naming convention as Tailwind for consistency.
 */

export const spacingTokens = {
  0: '0',
  px: '1px',
  0.5: '0.125rem', // 2px
  1: '0.25rem', // 4px
  1.5: '0.375rem', // 6px
  2: '0.5rem', // 8px
  2.5: '0.625rem', // 10px
  3: '0.75rem', // 12px
  3.5: '0.875rem', // 14px
  4: '1rem', // 16px - Base unit
  5: '1.25rem', // 20px
  6: '1.5rem', // 24px
  7: '1.75rem', // 28px
  8: '2rem', // 32px
  9: '2.25rem', // 36px
  10: '2.5rem', // 40px
  11: '2.75rem', // 44px
  12: '3rem', // 48px
  14: '3.5rem', // 56px
  16: '4rem', // 64px
  20: '5rem', // 80px
  24: '6rem', // 96px
  28: '7rem', // 112px
  32: '8rem', // 128px
  36: '9rem', // 144px
  40: '10rem', // 160px
  44: '11rem', // 176px
  48: '12rem', // 192px
  52: '13rem', // 208px
  56: '14rem', // 224px
  60: '15rem', // 240px
  64: '16rem', // 256px
  72: '18rem', // 288px
  80: '20rem', // 320px
  96: '24rem', // 384px
} as const;

/**
 * Component padding presets
 */
export const componentPadding = {
  button: {
    sm: { x: spacingTokens[3], y: spacingTokens[1.5] }, // 12px x 6px
    md: { x: spacingTokens[4], y: spacingTokens[2] }, // 16px x 8px
    lg: { x: spacingTokens[6], y: spacingTokens[2.5] }, // 24px x 10px
  },
  input: {
    sm: { x: spacingTokens[3], y: spacingTokens[2] }, // 12px x 8px
    md: { x: spacingTokens[3], y: spacingTokens[2] }, // 12px x 8px
    lg: { x: spacingTokens[4], y: spacingTokens[3] }, // 16px x 12px
  },
  card: {
    sm: spacingTokens[4], // 16px
    md: spacingTokens[6], // 24px
    lg: spacingTokens[8], // 32px
  },
  badge: {
    x: spacingTokens[2.5], // 10px
    y: spacingTokens[0.5], // 2px
  },
} as const;

/**
 * Layout spacing configuration
 */
export const layoutSpacing = {
  section: {
    y: spacingTokens[12], // 48px - Section vertical spacing
  },
  container: {
    x: spacingTokens[6], // 24px - Container horizontal margin
  },
  header: {
    height: spacingTokens[16], // 64px
    padding: spacingTokens[6], // 24px
  },
  footer: {
    padding: spacingTokens[12], // 48px
  },
} as const;

export type SpacingToken = keyof typeof spacingTokens;
