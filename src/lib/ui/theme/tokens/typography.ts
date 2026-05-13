/**
 *
 */

/**
 */
export const fontSizeTokens = {
  xs: '0.75rem', // 12px
  sm: '0.875rem', // 14px
  base: '1rem', // 16px 猸?Default
  lg: '1.125rem', // 18px
  xl: '1.25rem', // 20px
  '2xl': '1.5rem', // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem', // 36px
  '5xl': '3rem', // 48px
  '6xl': '3.75rem', // 60px
  '7xl': '4.5rem', // 72px
  '8xl': '6rem', // 96px
  '9xl': '8rem', // 128px
} as const;

/**
 */
export const fontWeightTokens = {
  thin: '100',
  extralight: '200',
  light: '300',
  normal: '400', // ?Default
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
} as const;

/**
 */
export const lineHeightTokens = {
  none: '1',
  tight: '1.25',
  snug: '1.375',
  normal: '1.5', // ?Default
  relaxed: '1.625',
  loose: '2',
  3: '.75rem', // 12px
  4: '1rem', // 16px
  5: '1.25rem', // 20px
  6: '1.5rem', // 24px
  7: '1.75rem', // 28px
  8: '2rem', // 32px
  9: '2.25rem', // 36px
  10: '2.5rem', // 40px
} as const;

/**
 */
export const letterSpacingTokens = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0', // ?Default
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
} as const;

/**
 */
export const fontFamilyTokens = {
  sans: 'var(--font-geist-sans)',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'var(--font-geist-mono)',
} as const;

/**
 */
export const headingStyles = {
  h1: {
    fontSize: fontSizeTokens['4xl'],
    fontWeight: fontWeightTokens.bold,
    lineHeight: lineHeightTokens.tight,
    letterSpacing: letterSpacingTokens.tight,
  },
  h2: {
    fontSize: fontSizeTokens['3xl'],
    fontWeight: fontWeightTokens.bold,
    lineHeight: lineHeightTokens.snug,
    letterSpacing: letterSpacingTokens.tight,
  },
  h3: {
    fontSize: fontSizeTokens['2xl'],
    fontWeight: fontWeightTokens.semibold,
    lineHeight: lineHeightTokens.snug,
    letterSpacing: letterSpacingTokens.normal,
  },
  h4: {
    fontSize: fontSizeTokens.xl,
    fontWeight: fontWeightTokens.semibold,
    lineHeight: lineHeightTokens.normal,
    letterSpacing: letterSpacingTokens.normal,
  },
  h5: {
    fontSize: fontSizeTokens.lg,
    fontWeight: fontWeightTokens.medium,
    lineHeight: lineHeightTokens.normal,
    letterSpacing: letterSpacingTokens.normal,
  },
  h6: {
    fontSize: fontSizeTokens.base,
    fontWeight: fontWeightTokens.medium,
    lineHeight: lineHeightTokens.normal,
    letterSpacing: letterSpacingTokens.normal,
  },
} as const;

/**
 */
export const bodyStyles = {
  large: {
    fontSize: fontSizeTokens.lg,
    lineHeight: lineHeightTokens.relaxed,
  },
  base: {
    fontSize: fontSizeTokens.base,
    lineHeight: lineHeightTokens.normal,
  },
  small: {
    fontSize: fontSizeTokens.sm,
    lineHeight: lineHeightTokens.normal,
  },
  tiny: {
    fontSize: fontSizeTokens.xs,
    lineHeight: lineHeightTokens.normal,
  },
} as const;

export type FontSizeToken = keyof typeof fontSizeTokens;
export type FontWeightToken = keyof typeof fontWeightTokens;
export type LineHeightToken = keyof typeof lineHeightTokens;
export type LetterSpacingToken = keyof typeof letterSpacingTokens;
export type FontFamilyToken = keyof typeof fontFamilyTokens;
