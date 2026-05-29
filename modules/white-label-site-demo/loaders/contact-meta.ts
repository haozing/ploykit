import { whiteLabelPageMeta } from './page-meta';

export default function contactMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('contact', ctx, {
    cache: { mode: 'no-store' },
    canonicalPath: '/contact',
  });
}
