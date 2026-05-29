import { whiteLabelPageMeta } from './page-meta';

export default function privacyMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('privacy', ctx, { canonicalPath: '/privacy' });
}
