import type { ModuleContext } from '@ploykit/module-sdk';

export default function publicToolMetadata(ctx: ModuleContext) {
  const origin = new URL(ctx.request.url).origin;
  return {
    title: 'Capability Demo | PloyKit',
    description:
      'A public module route that demonstrates PloyKit AI, RAG, jobs, events, webhooks, files and commercial guards.',
    canonical: `${origin}/demo`,
    robots: 'index,follow',
    openGraph: {
      title: 'Capability Demo',
      description: 'Explore first-class local module capabilities in PloyKit.',
      url: `${origin}/demo`,
    },
  };
}
