import { createElement as h } from 'react';
import { whiteLabelCopy } from '../locales';

export default function HomeHero(props?: { lang?: string }) {
  const copy = whiteLabelCopy(props?.lang).pages.contributions;
  return h(
    'div',
    {
      className:
        'rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm',
    },
    copy.homeHero
  );
}
