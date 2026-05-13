import { testPlugin } from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import notesApi from '../api/notes';

export default testPlugin(plugin, async ({ ctx, plugin }) => {
  if (plugin.trustLevel !== 'trusted') {
    throw new Error('Internal sample plugin must stay trusted.');
  }

  if (!plugin.routes?.pages?.some((route) => route.path === '/')) {
    throw new Error('Internal sample plugin must declare its local dashboard page.');
  }

  const notesCollection = plugin.data?.collections?.sample_internal_notes;
  if (!notesCollection) {
    throw new Error('Internal sample plugin must declare its notes collection.');
  }

  await notesApi.post?.({
    ...ctx,
    request: {
      ...ctx.request,
      async json() {
        return { title: 'First note', status: 'open' };
      },
    },
  });

  const response = await notesApi.get?.(ctx);
  const payload = (await response?.json()) as { notes?: unknown[] };

  if (!Array.isArray(payload.notes) || payload.notes.length !== 1) {
    throw new Error('Internal sample plugin API must round-trip storage records.');
  }
});
