import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function publishPost(
  ctx: ModuleContext,
  input: { postId?: string } = {}
) {
  const postId = input.postId?.trim();
  if (!postId) {
    throw new Error('CMS_DEMO_POST_ID_REQUIRED');
  }

  const table = ctx.data.table('posts');
  const existing = await table.findById(postId);
  if (!existing) {
    throw new Error(`CMS_DEMO_POST_NOT_FOUND: ${postId}`);
  }

  const publishedAt = new Date().toISOString();
  const post = await table.update(postId, {
    status: 'published',
    published_at: existing.published_at ?? publishedAt,
    metadata: {
      ...(typeof existing.metadata === 'object' && existing.metadata ? existing.metadata : {}),
      publishedBy: ctx.user?.id ?? 'system',
    },
  });
  await ctx.audit.record('cms-demo.post.published', {
    postId: post.id,
    slug: post.slug,
  });
  await ctx.usage.record({ meter: 'cms.posts.published', metadata: { slug: post.slug } });
  const event = await ctx.events.publish(
    'cms.post.published',
    {
      postId: post.id,
      slug: post.slug,
      title: post.title,
    },
    { idempotencyKey: `cms-demo-post-published-${post.id}` }
  );
  if (ctx.user?.id) {
    await ctx.notifications.send({
      userId: ctx.user.id,
      title: 'CMS post published',
      body: String(post.title),
      actionUrl: `/dashboard/cms-demo`,
      metadata: { postId: post.id, slug: post.slug },
    });
  }
  return { ok: true, post, eventId: event.id };
});
