import { whiteLabelPageMeta } from './page-meta';

export default function pricingMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('pricing', ctx, { canonicalPath: '/pricing' });
}
