import { createElement as h } from 'react';

export function contentPage(title: string, description: string, body: string, eyebrow: string) {
  return h(
    'main',
    { className: 'mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8' },
    h(
      'header',
      { className: 'mb-8' },
      h('p', { className: 'text-sm font-semibold uppercase tracking-normal text-primary' }, eyebrow),
      h('h1', { className: 'mt-3 text-4xl font-semibold tracking-normal text-foreground sm:text-5xl' }, title),
      h('p', { className: 'mt-4 max-w-2xl text-base leading-7 text-muted-foreground' }, description)
    ),
    h(
      'section',
      { className: 'rounded-md border border-border bg-card p-6 text-sm leading-7 text-muted-foreground shadow-sm' },
      body
    )
  );
}
