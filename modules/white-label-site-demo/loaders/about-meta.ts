import { whiteLabelPageMeta } from './page-meta';

export default function aboutMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('about', ctx, { canonicalPath: '/about' });
}
