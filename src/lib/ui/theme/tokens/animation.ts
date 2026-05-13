/**
 *
 */

/**
 */
export const durationTokens = {
  75: '75ms', //  - 寰氦浜?
  100: '100ms', // ?
  150: '150ms', //  猸?Default
  200: '200ms', //
  300: '300ms', // ?
  500: '500ms', //
  700: '700ms', //
  1000: '1000ms', //
} as const;

/**
 */
export const easingTokens = {
  linear: 'linear',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)', // ?RecommendedDefault
  'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',

  'ease-bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  'ease-smooth': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
} as const;

/**
 */
export const DEFAULT_TRANSITION = {
  duration: durationTokens[150],
  easing: easingTokens.out,
} as const;

/**
 */
export const componentTransitions = {
  fast: {
    duration: durationTokens[100],
    easing: easingTokens.out,
    properties: ['background-color', 'border-color', 'color', 'box-shadow', 'transform'],
  },

  normal: {
    duration: durationTokens[150],
    easing: easingTokens.out,
    properties: ['background-color', 'border-color', 'color', 'box-shadow', 'transform'],
  },

  slow: {
    duration: durationTokens[300],
    easing: easingTokens['in-out'],
    properties: ['opacity', 'transform'],
  },

  page: {
    duration: durationTokens[200],
    easing: easingTokens.out,
    properties: ['opacity', 'transform'],
  },
} as const;

/**
 */
export const keyframesTokens = {
  fadeIn: {
    from: { opacity: '0' },
    to: { opacity: '1' },
  },
  fadeOut: {
    from: { opacity: '1' },
    to: { opacity: '0' },
  },

  slideUp: {
    from: { opacity: '0', transform: 'translateY(20px)' },
    to: { opacity: '1', transform: 'translateY(0)' },
  },
  slideDown: {
    from: { opacity: '0', transform: 'translateY(-20px)' },
    to: { opacity: '1', transform: 'translateY(0)' },
  },
  slideLeft: {
    from: { opacity: '0', transform: 'translateX(20px)' },
    to: { opacity: '1', transform: 'translateX(0)' },
  },
  slideRight: {
    from: { opacity: '0', transform: 'translateX(-20px)' },
    to: { opacity: '1', transform: 'translateX(0)' },
  },

  scaleIn: {
    from: { opacity: '0', transform: 'scale(0.95)' },
    to: { opacity: '1', transform: 'scale(1)' },
  },
  scaleOut: {
    from: { opacity: '1', transform: 'scale(1)' },
    to: { opacity: '0', transform: 'scale(0.95)' },
  },

  float: {
    '0%, 100%': { transform: 'translateY(0px)' },
    '50%': { transform: 'translateY(-10px)' },
  },

  pulse: {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0.5' },
  },

  gradient: {
    '0%, 100%': { backgroundPosition: '0% 50%' },
    '50%': { backgroundPosition: '100% 50%' },
  },

  spin: {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },

  bounce: {
    '0%, 100%': {
      transform: 'translateY(-25%)',
      animationTimingFunction: 'cubic-bezier(0.8, 0, 1, 1)',
    },
    '50%': { transform: 'translateY(0)', animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)' },
  },
} as const;

export type DurationToken = keyof typeof durationTokens;
export type EasingToken = keyof typeof easingTokens;
export type KeyframeToken = keyof typeof keyframesTokens;
