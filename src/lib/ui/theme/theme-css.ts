import type { ThemeTokens } from './types';

export function tokensToCSS(tokens: ThemeTokens): string {
  return `
    --font-family: ${tokens.common.fontFamily};
    --color-bg: ${tokens.common.colorBg};
    --color-text: ${tokens.common.colorText};
    --color-primary: ${tokens.common.colorPrimary};
    --color-primary-text: ${tokens.common.colorPrimaryText};
    --radius: ${tokens.common.radius};
    --shadow: ${tokens.common.shadow};
    --container-max-w: ${tokens.common.containerMaxW};

    --header-height: ${tokens.header.height};
    --header-bg: ${tokens.header.bg};
    --header-text: ${tokens.header.text};
    --header-border-bottom: ${tokens.header.borderBottom || 'none'};
    --header-padding-x: ${tokens.header.paddingX || '24px'};
    --header-padding-y: ${tokens.header.paddingY || '12px'};

    --footer-bg: ${tokens.footer.bg};
    --footer-text: ${tokens.footer.text};
    --footer-border-top: ${tokens.footer.borderTop || 'none'};
    --footer-padding-y: ${tokens.footer.paddingY};
    --footer-padding-x: ${tokens.footer.paddingX || '24px'};

    --content-padding-y: ${tokens.content.paddingY};
    --content-bg: ${tokens.content.bg || 'transparent'};
  `.trim();
}
