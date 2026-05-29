import { whiteLabelPageMeta } from './page-meta';

export default function homeMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('home', ctx, { canonicalPath: '/' });
}
