import { createElement as h, type ReactNode } from 'react';
import { localizedHref, whiteLabelCopy } from '../locales';

type AuthMode = 'login' | 'register' | 'forgot-password' | 'reset-password';

interface AuthViewOptions {
  mode: AuthMode;
  action: string;
  lang?: string;
  nextPath?: string;
  error?: string;
  notice?: string;
  token?: string;
}

export function authView(options: AuthViewOptions) {
  const copy = whiteLabelCopy(options.lang).pages.auth;
  const modeCopy = copy.modes[options.mode];
  return h(
    'main',
    { className: 'min-h-screen bg-background text-foreground' },
    h(
      'section',
      { className: 'mx-auto grid min-h-screen w-full max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center' },
      h(
        'div',
        { className: 'space-y-6' },
        h('a', { href: localizedHref(options.lang), className: 'inline-flex items-center gap-3 font-semibold text-foreground' },
          h('span', { className: 'grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground' }, 'AC'),
          h('span', null, copy.brand)
        ),
        h('p', { className: 'text-sm font-semibold uppercase tracking-normal text-primary' }, copy.eyebrow),
        h('h1', { className: 'max-w-xl text-4xl font-semibold tracking-normal text-foreground sm:text-5xl' }, modeCopy.title),
        h('p', { className: 'max-w-lg text-base leading-7 text-muted-foreground' }, modeCopy.description),
        h(
          'div',
          { className: 'rounded-md border border-border bg-card p-4 text-sm leading-6 text-muted-foreground' },
          copy.supportingText
        )
      ),
      h(
        'form',
        { action: options.action, method: 'post', className: 'rounded-md border border-border bg-card p-6 shadow-sm' },
        h('input', {
          type: 'hidden',
          name: 'next',
          value: options.nextPath ?? localizedHref(options.lang, '/dashboard'),
        }),
        options.mode !== 'reset-password'
          ? field(copy.email, h('input', inputProps('email', 'email', copy.emailPlaceholder)))
          : null,
        options.mode === 'register'
          ? field(copy.displayName, h('input', inputProps('displayName', 'text', copy.displayNamePlaceholder)))
          : null,
        options.mode === 'reset-password'
          ? field(
              copy.resetToken,
              h('input', {
                ...inputProps('token', 'text', copy.resetTokenPlaceholder),
                defaultValue: options.token ?? '',
              })
            )
          : null,
        options.mode !== 'forgot-password'
          ? field(copy.password, h('input', inputProps('password', 'password', copy.passwordPlaceholder)))
          : null,
        options.error
          ? h('p', { className: 'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive' }, copy.error)
          : null,
        options.notice
          ? h('p', { className: 'rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success' }, options.notice)
          : null,
        h(
          'button',
          { type: 'submit', className: 'mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground' },
          modeCopy.submitLabel
        ),
        h(
          'div',
          { className: 'mt-5 flex flex-wrap justify-center gap-4 text-sm text-muted-foreground' },
          h('a', { href: localizedHref(options.lang, '/login') }, copy.links.login),
          h('a', { href: localizedHref(options.lang, '/register') }, copy.links.register),
          h('a', { href: localizedHref(options.lang, '/forgot-password') }, copy.links.forgotPassword)
        )
      )
    )
  );
}

function inputProps(name: string, type: string, placeholder: string) {
  return {
    name,
    type,
    placeholder,
    className:
      'mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary',
  };
}

function field(label: string, control: ReactNode) {
  return h('label', { className: 'mb-4 block text-sm font-medium text-foreground' }, label, control);
}
