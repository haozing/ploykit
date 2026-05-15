import { defineApi, z } from '@ploykit/plugin-sdk';

const createNoteSchema = z.object({
  title: z.string().min(1).max(120),
  status: z.enum(['open', 'done']).default('open'),
  body: z.string().optional(),
});

export default defineApi({
  async get(ctx) {
    const projectId = ctx.request.params.projectId;
    const preview = ctx.request.query.get('preview') === 'true';
    const includeProject = ctx.request.query.get('includeProject') === 'true';
    const notes = await ctx.storage.collection('sample_internal_notes').findMany({
      orderBy: { title: 'asc' },
      limit: 25,
    });
    const project =
      includeProject && projectId
        ? await ctx.services.json('core-api', {
            method: 'GET',
            template: '/v1/projects/:projectId',
            params: { projectId },
          })
        : null;

    return ctx.json({ notes, projectId, preview, project });
  },

  async post(ctx) {
    const input = await ctx.request.json(createNoteSchema);
    const note = await ctx.storage.collection('sample_internal_notes').insert(input);

    await ctx.ui.toast.success('Note created');

    return ctx.json({ note }, { status: 201 });
  },
});
