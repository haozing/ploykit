import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestingModuleContext } from '@ploykit/module-sdk';
import moduleDefinition from '../module';
import postsApi from '../api/posts';
import notesApi from '../api/notes';
import publishPost from '../actions/publish-post';
import createNote from '../actions/create-note';
import loadPublicPosts from '../loaders/public-posts';
import loadStudio from '../loaders/studio';
import loadNotes from '../loaders/notes';

test('cms-demo declares product CMS routes, data and publish workflow', () => {
  assert.equal(moduleDefinition.id, 'cms-demo');
  assert.ok(moduleDefinition.data?.tables?.posts);
  assert.ok(moduleDefinition.data?.tables?.categories);
  assert.ok(moduleDefinition.data?.tables?.notes);
  assert.equal(moduleDefinition.routes?.site?.[0]?.path, '/cms-demo');
  assert.equal(moduleDefinition.routes?.dashboard?.[0]?.path, '/cms-demo');
  assert.equal(moduleDefinition.routes?.dashboard?.[1]?.path, '/cms-demo/notes');
  assert.equal(moduleDefinition.routes?.api?.[0]?.path, '/cms-demo/posts');
  assert.equal(moduleDefinition.routes?.api?.[1]?.path, '/cms-demo/notes');
  assert.ok(moduleDefinition.actions?.publishPost);
  assert.ok(moduleDefinition.actions?.createNote);
  assert.deepEqual(moduleDefinition.events?.publishes, ['cms.post.published']);
});

test('cms-demo creates drafts and publishes through action evidence', async () => {
  const ctx = createTestingModuleContext({
    moduleId: 'cms-demo',
    request: {
      async json<T = unknown>() {
        return {
          title: 'Product launch notes',
          body: 'The CMS module can publish real content.',
          category: 'Launch',
          excerpt: 'A product CMS sample.',
        } as T;
      },
    },
  });

  const response = await postsApi.post?.(ctx);
  assert.equal(response?.status, 201);
  const body = (await response?.json()) as {
    ok: boolean;
    post: { id: string; slug: string; status: string };
    category: { slug: string };
  };
  assert.equal(body.ok, true);
  assert.equal(body.post.slug, 'product-launch-notes');
  assert.equal(body.category.slug, 'launch');

  const published = await publishPost.run(ctx, { postId: body.post.id });
  assert.equal(published.ok, true);
  assert.equal(published.post.status, 'published');

  const publicView = await loadPublicPosts(ctx);
  assert.equal(publicView.posts.length, 1);
  assert.equal(publicView.posts[0]?.slug, 'product-launch-notes');

  const studio = await loadStudio(ctx);
  assert.equal(studio.metrics.published, 1);

  const note = await createNote.run(ctx, {
    title: 'Merged note',
    body: 'Created by the CMS module notes route.',
    attachmentName: 'note.txt',
    attachmentContent: 'attached',
  });
  assert.equal(note.ok, true);
  assert.equal(note.note.title, 'Merged note');
  assert.ok(note.attachmentFileId);

  const notesResponse = await notesApi.get?.(ctx);
  const notesBody = (await notesResponse?.json()) as {
    ok: boolean;
    notes: { title: string }[];
  };
  assert.equal(notesBody.ok, true);
  assert.equal(notesBody.notes[0]?.title, 'Merged note');

  const notesView = await loadNotes(ctx);
  assert.equal(notesView.total, 1);
});
