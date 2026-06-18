# Recipe: Public Page

Intent: publish a site page through the module contract with metadata and cache policy.

## Use

- `module.ts`: `routes.site`, `metadata`, `cache`, and optional `publicAliases`.
- Runtime: loaders read `ctx.data` or service data; components render content only.
- Permissions: depends on loader/action needs; common examples are `Permission.DataTableRead` and `Permission.SurfaceContribute`.
- Reference: `modules/cms-demo/module.ts`.

## Contract Shape

```ts
permissions: [Permission.DataTableRead],
routes: {
  site: [{
    path: '/blog',
    component: './pages/PublicBlogPage',
    loader: './loaders/public-posts',
    metadata: './loaders/blog-metadata',
    publicAliases: ['/news'],
    auth: 'public',
    cache: {
      strategy: 'public',
      revalidateSeconds: 120,
      tags: ['blog'],
    },
  }],
},
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
