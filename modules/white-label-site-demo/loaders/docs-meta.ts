import { whiteLabelPageMeta } from './page-meta';

export default function docsMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('docs', ctx, { canonicalPath: '/docs' });
}
