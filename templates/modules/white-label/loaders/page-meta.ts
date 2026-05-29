import { definePagePresentation } from '@ploykit/module-sdk/presentation';
import { languageFromRequest, templateCopy } from '../locales';

export function whiteLabelPageMeta(pageKey: 'home', ctx?: { request?: Request }) {
  const lang = languageFromRequest(ctx?.request);
  const messages = templateCopy(lang);
  const page = messages.pages[pageKey];
  const seo = messages.seo[pageKey];

  return definePagePresentation({
    title: page.title,
    description: page.description,
    seo: {
      title: seo.title,
      description: seo.description,
      canonicalPath: '/',
    },
    shell: {
      area: 'site',
      chrome: 'site',
      wide: true,
    },
    cache: {
      mode: 'public',
      revalidateSeconds: 300,
    },
    i18n: {
      namespaces: ['__MODULE_ID__'],
      defaultLocale: 'zh',
    },
  });
}
