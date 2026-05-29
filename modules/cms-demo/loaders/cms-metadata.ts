import type { ModuleContext } from '@ploykit/module-sdk';

export default function cmsMetadata(ctx: ModuleContext) {
  const origin = new URL(ctx.request.url).origin;
  return {
    title: 'CMS Demo | PloyKit',
    description: 'A product-grade CMS sample module with posts, categories and a publish workflow.',
    canonical: `${origin}/cms-demo`,
    robots: 'index,follow',
    openGraph: {
      title: 'CMS Demo',
      description: 'Publish content through a first-class local PloyKit module.',
      url: `${origin}/cms-demo`,
    },
  };
}
