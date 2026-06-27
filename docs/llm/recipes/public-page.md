# Recipe: Public Page

Intent: publish an indexable site page through the module contract with metadata, cache policy, and optional public aliases.

## Use

- Declare the page in `pages` with `area: 'site'`, `frame: 'site'`, `auth: 'public'`, metadata, and cache.
- Render page content with TSX only.
- Add `navigation` when the public page should be discoverable from the site header or footer.
- Declare only the permissions required by loaders, APIs, actions, or surfaces.

## Contract Shape

```ts
import { defineModule, page } from '@ploykit/module-sdk';

export default defineModule({
  id: 'blog',
  name: 'Blog',
  version: '0.1.0',
  pages: [
    page({
      id: 'blog.index',
      area: 'site',
      path: '/blog',
      frame: 'site',
      component: './pages/PublicBlogPage.tsx',
      loader: './loaders/public-posts',
      metadata: './loaders/blog-metadata',
      metadataResult: {
        required: ['title', 'description', 'canonical', 'sitemap'],
      },
      auth: 'public',
      publicAliases: ['/news'],
      cache: {
        strategy: 'public',
        revalidateSeconds: 120,
        tags: ['blog'],
      },
    }),
  ],
  navigation: {
    location: 'site.header',
    fallbackLabel: 'Blog',
    path: '/blog',
  },
});
```

## Loader Shape

```ts
export default async function loadPublicPosts(ctx: ModuleContext) {
  const posts = await ctx.data.table('posts').list({ limit: 20 });
  return { posts };
}
```

## Verify

Run:

```bash
npm run modules:scan
npm run module:doctor -- <id>
npm run seo:check
npm run module:test -- <id> --summary
```

## Red Lines

- Do not make public pages depend on browser-only session state.
- Do not skip metadata for indexable pages.
- Do not read host private internals for SEO or cache behavior.
