import { whiteLabelPageMeta } from './page-meta';

export default function termsMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('terms', ctx, { canonicalPath: '/terms' });
}
