import { createElement as h } from 'react';
import { localizedHref, whiteLabelCopy } from '../locales';

export default function HomePage(props?: { lang?: string }) {
  const copy = whiteLabelCopy(props?.lang).pages.home;
  return h(
    'main',
    { className: 'mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:px-8' },
    h(
      'section',
      { className: 'grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center' },
      h(
        'div',
        { className: 'space-y-6' },
        h(
          'p',
          { className: 'text-sm font-semibold uppercase tracking-normal text-primary' },
          copy.eyebrow
        ),
        h(
          'h1',
          { className: 'max-w-3xl text-5xl font-semibold tracking-normal text-foreground sm:text-6xl' },
          copy.title
        ),
        h(
          'p',
          { className: 'max-w-2xl text-lg leading-8 text-muted-foreground' },
          copy.description
        ),
        h(
          'div',
          { className: 'flex flex-wrap gap-3' },
          h(
            'a',
            {
              href: localizedHref(props?.lang, '/register'),
              className:
                'inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground',
            },
            copy.primaryAction
          ),
          h(
            'a',
            {
              href: localizedHref(props?.lang, '/pricing'),
              className:
                'inline-flex min-h-11 items-center rounded-md border border-border bg-card px-5 text-sm font-semibold text-foreground',
            },
            copy.secondaryAction
          )
        )
      ),
      h(
      'div',
      { className: 'rounded-md border border-border bg-card p-5 shadow-sm' },
        h('p', { className: 'text-sm text-muted-foreground' }, copy.capabilityTitle),
        h(
          'div',
          { className: 'mt-4 grid gap-3' },
          copy.capabilities.map((item) =>
            h(
              'div',
              {
                key: item,
                className:
                  'flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm',
              },
              h('span', null, item),
              h('strong', { className: 'text-primary' }, copy.status)
            )
          )
        )
      )
    )
  );
}
