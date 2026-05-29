import { definePagePresentation } from '@ploykit/module-sdk/presentation';
import { languageFromRequest, whiteLabelCopy } from '../locales';

interface WhiteLabelPageMetaOptions {
  area?: 'site' | 'auth' | 'dashboard';
  chrome?: 'site' | 'none' | 'workspace';
  wide?: boolean;
  cache?: { mode: 'public'; revalidateSeconds?: number } | { mode: 'private' | 'no-store' };
  canonicalPath?: string;
  noindex?: boolean;
}

export function whiteLabelPageMeta(
  pageKey: string,
  ctx: { request?: Request } | undefined,
  options: WhiteLabelPageMetaOptions = {}
) {
  const lang = languageFromRequest(ctx?.request);
  const messages = whiteLabelCopy(lang);
  const page = messages.pages[pageKey as keyof typeof messages.pages] as {
    title?: string;
    description?: string;
  };
  const seo = (messages.seo[pageKey as keyof typeof messages.seo] ?? page) as {
    title: string;
    description: string;
  };

  return definePagePresentation({
    title: page.title ?? seo.title,
    description: page.description ?? seo.description,
    seo: {
      title: seo.title,
      description: seo.description,
      canonicalPath: options.canonicalPath,
      noindex: options.noindex,
    },
    shell: {
      area: options.area ?? 'site',
      chrome: options.chrome ?? 'site',
      wide: options.wide ?? true,
    },
    cache: options.cache ?? {
      mode: 'public',
      revalidateSeconds: 300,
    },
    i18n: {
      namespaces: ['white-label-site-demo'],
      defaultLocale: 'zh',
    },
  });
}
