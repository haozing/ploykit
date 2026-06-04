export function whiteLabelPageMeta(page: string, _ctx?: { request?: Request }) {
  return {
    title: '__MODULE_NAME__',
    description: `White-label ${page} page for __MODULE_NAME__.`,
    canonical: '/',
    sitemap: true,
    openGraph: {
      title: '__MODULE_NAME__',
      description: `White-label ${page} page for __MODULE_NAME__.`,
    },
  };
}
