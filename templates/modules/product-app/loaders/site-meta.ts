export default async function loadSiteMeta() {
  return {
    title: '__MODULE_NAME__',
    description: 'Public product page for __MODULE_NAME__.',
    canonical: '/__MODULE_ID__',
    sitemap: true,
    openGraph: {
      title: '__MODULE_NAME__',
      description: 'Public product page for __MODULE_NAME__.',
    },
  };
}
