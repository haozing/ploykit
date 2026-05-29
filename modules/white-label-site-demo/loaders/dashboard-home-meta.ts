import { whiteLabelPageMeta } from './page-meta';

export default function dashboardHomeMeta(ctx?: { request?: Request }) {
  return whiteLabelPageMeta('dashboardHome', ctx, {
    area: 'dashboard',
    chrome: 'workspace',
    cache: { mode: 'private' },
    noindex: true,
  });
}
