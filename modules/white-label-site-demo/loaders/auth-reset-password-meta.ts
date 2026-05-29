import { whiteLabelPageMeta } from './page-meta';

export default function authResetPasswordMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('auth', ctx, {
    area: 'auth',
    chrome: 'none',
    cache: { mode: 'no-store' },
    noindex: true,
  });
}
