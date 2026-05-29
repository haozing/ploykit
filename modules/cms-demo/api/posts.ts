import { defineApi } from '@ploykit/module-sdk';

type PostInput = {
  title?: string;
  slug?: string;
  excerpt?: string;
  body?: string;
  category?: string;
  status?: 'draft' | 'published';
  seoTitle?: string;
  seoDescription?: string;
};

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function requiredText(value: string | undefined, code: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(code);
  }
  return trimmed;
}

export default defineApi({
  async get(ctx) {
    const [posts, categories] = await Promise.all([
      ctx.data.table('posts').findMany({ orderBy: { updated_at: 'desc' }, limit: 50 }),
      ctx.data.table('categories').findMany({ orderBy: { name: 'asc' }, limit: 50 }),
    ]);
    return ctx.json({ ok: true, posts, categories });
  },
  async post(ctx) {
    let input: PostInput;
    try {
      input = await ctx.request.json<PostInput>();
    } catch {
      return ctx.json({ ok: false, code: 'CMS_DEMO_INVALID_JSON' }, { status: 400 });
    }

    let title: string;
    let body: string;
    try {
      title = requiredText(input.title, 'CMS_DEMO_TITLE_REQUIRED');
      body = requiredText(input.body, 'CMS_DEMO_BODY_REQUIRED');
    } catch (error) {
      return ctx.json(
        { ok: false, code: error instanceof Error ? error.message : 'CMS_DEMO_INVALID_INPUT' },
        { status: 400 }
      );
    }

    const categoryName = input.category?.trim() || 'General';
    const categorySlug = slugify(categoryName) || 'general';
    const category = await ctx.data.table('categories').upsert(
      {
        name: categoryName,
        slug: categorySlug,
        status: 'active',
        metadata: { source: 'api' },
      },
      { uniqueBy: ['slug'] }
    );
    const status = input.status === 'published' ? 'published' : 'draft';
    const slug = slugify(input.slug || title);
    if (!slug) {
      return ctx.json({ ok: false, code: 'CMS_DEMO_SLUG_REQUIRED' }, { status: 400 });
    }

    const post = await ctx.data.table('posts').insert({
      title,
      slug,
      excerpt: input.excerpt?.trim() || null,
      body,
      status,
      category_slug: category.slug,
      seo_title: input.seoTitle?.trim() || title,
      seo_description: input.seoDescription?.trim() || input.excerpt?.trim() || null,
      published_at: status === 'published' ? new Date().toISOString() : null,
      metadata: { source: 'api', categoryId: category.id },
    });
    await ctx.usage.record({ meter: 'cms.posts.created', metadata: { status } });
    await ctx.audit.record('cms-demo.post.created', {
      postId: post.id,
      slug: post.slug,
      status,
    });
    return ctx.json({ ok: true, post, category }, { status: 201 });
  },
});
