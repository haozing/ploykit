import { createElement as h } from 'react';
import { localizedHref, whiteLabelCopy } from '../locales';

export default function PricingPage(props?: { lang?: string }) {
  const copy = whiteLabelCopy(props?.lang).pages.pricing;
  return h(
    'main',
    { className: 'mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8' },
    h(
      'header',
      { className: 'mb-10 max-w-3xl' },
      h('p', { className: 'text-sm font-semibold uppercase tracking-normal text-primary' }, copy.eyebrow),
      h('h1', { className: 'mt-3 text-4xl font-semibold tracking-normal text-foreground sm:text-5xl' }, copy.title),
      h(
        'p',
        { className: 'mt-4 text-base leading-7 text-muted-foreground' },
        copy.description
      )
    ),
    h(
      'section',
      { className: 'grid gap-4 md:grid-cols-3' },
      copy.plans.map((plan) =>
        h(
          'article',
          { key: plan.name, className: 'rounded-md border border-border bg-card p-5 shadow-sm' },
          h('h2', { className: 'text-lg font-semibold text-foreground' }, plan.name),
          h('p', { className: 'mt-3 text-3xl font-semibold text-primary' }, plan.price),
          h('p', { className: 'mt-4 min-h-20 text-sm leading-6 text-muted-foreground' }, plan.detail),
          h(
            'a',
            {
              href: localizedHref(props?.lang, '/register'),
              className:
                'mt-5 inline-flex min-h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground',
            },
            copy.choose
          )
        )
      )
    )
  );
}
