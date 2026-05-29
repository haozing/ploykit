import { createElement as h } from 'react';
import { whiteLabelCopy } from '../locales';

export default function ContactPage(props: { contactState?: string; lang?: string }) {
  const lang = props.lang ?? 'zh';
  const copy = whiteLabelCopy(lang).pages.contact;
  return h(
    'main',
    { className: 'mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8' },
    h(
      'header',
      { className: 'mb-8' },
      h('p', { className: 'text-sm font-semibold uppercase tracking-normal text-primary' }, copy.eyebrow),
      h('h1', { className: 'mt-3 text-4xl font-semibold tracking-normal text-foreground sm:text-5xl' }, copy.title),
      h(
        'p',
        { className: 'mt-4 max-w-2xl text-base leading-7 text-muted-foreground' },
        copy.description
      )
    ),
    props.contactState === 'received'
      ? h('p', { className: 'mb-4 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-success' }, copy.received)
      : null,
    props.contactState === 'failed'
      ? h('p', { className: 'mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive' }, copy.failed)
      : null,
    h(
      'form',
      { action: '/api/contact', method: 'post', className: 'rounded-md border border-border bg-card p-6 shadow-sm' },
      h('input', { type: 'hidden', name: 'lang', value: lang }),
      field(copy.name, 'name', copy.namePlaceholder),
      field(copy.email, 'email', copy.emailPlaceholder, 'email'),
      field(copy.company, 'company', copy.optional),
      h(
        'label',
        { className: 'mb-4 block text-sm font-medium text-foreground' },
        copy.message,
        h('textarea', {
          name: 'message',
          required: true,
          rows: 6,
          maxLength: 2000,
          placeholder: copy.messagePlaceholder,
          className:
            'mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary',
        })
      ),
      h(
        'button',
        { type: 'submit', className: 'inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground' },
        copy.submit
      )
    )
  );
}

function field(label: string, name: string, placeholder: string, type = 'text') {
  return h(
    'label',
    { className: 'mb-4 block text-sm font-medium text-foreground' },
    label,
    h('input', {
      name,
      type,
      required: name === 'name' || name === 'email',
      maxLength: name === 'email' ? 200 : 160,
      placeholder,
      className:
        'mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary',
    })
  );
}
