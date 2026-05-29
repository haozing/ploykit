import type { ModuleContext } from '@ploykit/module-sdk';

export default function publicToolsMetadata(ctx: ModuleContext) {
  const origin = new URL(ctx.request.url).origin;
  return {
    title: 'Public JSON and CSV Tools | PloyKit',
    description: 'Format JSON, minify JSON and convert CSV through the PloyKit module runtime.',
    canonical: `${origin}/public-tools`,
    robots: 'index,follow',
    openGraph: {
      title: 'Public JSON and CSV Tools',
      description: 'Public utility tools served by a first-class local PloyKit module.',
      url: `${origin}/public-tools`,
    },
  };
}
