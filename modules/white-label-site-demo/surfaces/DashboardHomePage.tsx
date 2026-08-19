import { createElement as h } from 'react';
import { formatCopy, localizedHref, whiteLabelCopy } from '../locales';

export default function DashboardHomePage(props: { lang?: string; userEmail?: string }) {
  const copy = whiteLabelCopy(props.lang).pages.dashboardHome;
  return h(
    'main',
    { className: 'min-h-screen bg-background text-foreground' },
    h(
      'section',
      { className: 'mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8' },
      h(
        'header',
        { className: 'rounded-md border border-border bg-card p-6 shadow-sm' },
        h('p', { className: 'text-sm font-semibold uppercase tracking-normal text-primary' }, copy.eyebrow),
        h('h1', { className: 'mt-3 text-3xl font-semibold tracking-normal text-foreground' }, copy.title),
        h(
          'p',
          { className: 'mt-2 max-w-2xl text-sm leading-6 text-muted-foreground' },
          props.userEmail
            ? formatCopy(copy.signedInDescription, { email: props.userEmail })
            : copy.description
        )
      ),
      h(
        'section',
        { className: 'grid gap-4 md:grid-cols-3' },
        ...copy.cards.map(([label, value, detail]) => card(label, value, detail))
      ),
      h(
        'section',
        { className: 'rounded-md border border-border bg-card p-5 shadow-sm' },
        h('h2', { className: 'text-lg font-semibold text-foreground' }, copy.pinnedTools),
        h(
          'div',
          { className: 'mt-4 grid gap-3 md:grid-cols-2' },
          copy.tools.map((item) =>
            h(
              'a',
              {
                key: item,
                href: localizedHref(props.lang, '/dashboard'),
                className:
                  'rounded-md border border-border bg-background px-4 py-3 text-sm font-medium text-foreground hover:bg-muted',
              },
              item
            )
          )
        )
      )
    )
  );
}

function card(label: string, value: string, detail: string) {
  return h(
    'article',
    { className: 'rounded-md border border-border bg-card p-5 shadow-sm' },
    h('span', { className: 'text-sm text-muted-foreground' }, label),
    h('strong', { className: 'mt-2 block text-3xl font-semibold text-primary' }, value),
    h('p', { className: 'mt-3 text-sm leading-6 text-muted-foreground' }, detail)
  );
}
