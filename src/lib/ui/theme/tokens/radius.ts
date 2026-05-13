/**
 *
 */

export const radiusTokens = {
  none: '0',
  xs: '0.25rem', // 4px
  sm: '0.375rem', // 6px
  md: '0.5rem', // 8px
  lg: '0.75rem', // 12px 猸?RecommendedDefault
  xl: '1rem', // 16px
  '2xl': '1.25rem', // 20px
  '3xl': '1.5rem', // 24px
  full: '9999px', //
} as const;

/**
 */
export const DEFAULT_RADIUS = radiusTokens.lg; // 12px

/**
 */
export const componentRadius = {
  button: radiusTokens.lg, // )2px
  input: radiusTokens.lg, // 12px
  textarea: radiusTokens.lg, // 12px
  select: radiusTokens.lg, // Choose鍣細12px
  card: radiusTokens.xl, // )6px
  badge: radiusTokens.md, // )px
  dialog: radiusTokens['2xl'], // )0px
  popover: radiusTokens.xl, // )6px
  dropdown: radiusTokens.lg, // )2px
  avatar: radiusTokens.full, // When
  tag: radiusTokens.sm, // tags)px
  tooltip: radiusTokens.md, // Tip)px
} as const;

export type RadiusToken = keyof typeof radiusTokens;
export type ComponentRadius = keyof typeof componentRadius;
