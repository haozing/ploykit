/**
 *
 */

export * from './radius';
export * from './shadows';
export * from './spacing';
export * from './typography';
export * from './animation';

/**
 */
import * as radius from './radius';
import * as shadows from './shadows';
import * as spacing from './spacing';
import * as typography from './typography';
import * as animation from './animation';

export const designTokens = {
  radius,
  shadows,
  spacing,
  typography,
  animation,
} as const;
