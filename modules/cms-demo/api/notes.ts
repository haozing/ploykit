import { defineApi } from '@ploykit/module-sdk';

type NoteInput = {
  title?: string;
  body?: string;
  attachmentName?: string;
  attachmentContent?: string;
};

export default defineApi({
  async get(ctx) {
    const notes = await ctx.data.table('notes').findMany({
      orderBy: { updated_at: 'desc' },
      limit: 50,
    });
    return ctx.json({ ok: true, notes });
  },
  async post(ctx) {
    const input = await ctx.request.json<NoteInput>();
    if (!input.title?.trim()) {
      return ctx.json(
        {
          ok: false,
          code: 'CMS_DEMO_NOTE_TITLE_REQUIRED',
          message: 'Title is required.',
        },
        { status: 400 }
      );
    }

    let attachmentFileId: string | null = null;
    if (input.attachmentName && input.attachmentContent !== undefined) {
      const upload = await ctx.files.createUpload({
        name: input.attachmentName,
        purpose: 'source',
        contentType: 'text/plain',
      });
      const file = await ctx.files.completeUpload(upload.file.id, {
        content: input.attachmentContent,
      });
      attachmentFileId = file.id;
    }

    const note = await ctx.data.table('notes').insert({
      title: input.title.trim(),
      body: input.body ?? null,
      status: 'draft',
      attachment_file_id: attachmentFileId,
      metadata: { source: 'api' },
    });
    await ctx.usage.record({ meter: 'cms.notes.created' });
    return ctx.json({ ok: true, note }, { status: 201 });
  },
});
