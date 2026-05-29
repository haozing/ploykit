import { createElement as h } from 'react';
import { localizedHref, whiteLabelCopy } from '../locales';

export default function AdminModulesActions(props?: { lang?: string }) {
  const copy = whiteLabelCopy(props?.lang).pages.contributions;
  return h(
    'a',
    {
      href: localizedHref(props?.lang, '/docs'),
      className:
        'inline-flex min-h-8 items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    },
    copy.adminModulesAction
  );
}
