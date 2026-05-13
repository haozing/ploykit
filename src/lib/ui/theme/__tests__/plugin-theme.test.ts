import { describe, expect, it } from 'vitest';
import { applyPluginThemeTokens } from '../plugin-theme.server';
import type { ThemeTokens } from '../types';

const baseTokens: ThemeTokens = {
  common: {
    fontFamily: 'sans-serif',
    colorBg: '#ffffff',
    colorText: '#111111',
    colorPrimary: '#6366f1',
    colorPrimaryText: '#ffffff',
    radius: '6px',
    shadow: 'none',
    containerMaxW: '1200px',
    mode: 'light',
  },
  header: {
    height: '64px',
    bg: '#ffffff',
    text: '#111111',
    borderBottom: '1px solid #eeeeee',
    variant: 'solid',
  },
  footer: {
    bg: '#f5f5f5',
    text: '#666666',
    paddingY: '48px',
  },
  content: {
    paddingY: '48px',
    bg: '#ffffff',
  },
};

describe('plugin theme tokens', () => {
  it('merges controlled plugin theme overrides without dropping base tokens', () => {
    expect(
      applyPluginThemeTokens(baseTokens, {
        common: {
          colorPrimary: '#0ea5e9',
        },
        header: {
          sticky: true,
        },
      })
    ).toMatchObject({
      common: {
        colorPrimary: '#0ea5e9',
        colorText: '#111111',
      },
      header: {
        height: '64px',
        sticky: true,
      },
      footer: baseTokens.footer,
      content: baseTokens.content,
    });
  });
});
