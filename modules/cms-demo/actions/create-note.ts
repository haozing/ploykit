import { action, type ModuleContext } from '@ploykit/module-sdk';

export default action(async function createNote(
  ctx: ModuleContext,
  input: {
    title?: string;
    body?: string;
    attachmentName?: string;
    attachmentContent?: string;
  } = {}
) {
  const title = input.title?.trim();
  if (!title) {
    throw new Error('CMS_DEMO_NOTE_TITLE_REQUIRED');
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
    title,
    body: input.body ?? null,
    status: 'draft',
    attachment_file_id: attachmentFileId,
    metadata: { source: 'action' },
  });
  await ctx.usage.record({ meter: 'cms.notes.created' });
  return { ok: true, note, attachmentFileId };
});
