import { createPluginTestHost, testPlugin } from '@ploykit/plugin-sdk/testing';
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

  const serviceHost = createPluginTestHost(plugin, {
    params: { projectId: 'project-1' },
    query: { preview: true, includeProject: true },
    services: {
      'core-api': async (request) => {
        if (request.path !== '/v1/projects/project-1') {
          return Response.json({ error: 'unexpected project path' }, { status: 404 });
        }

        return Response.json({ id: 'project-1', name: 'Project 1' });
      },
    },
  });

  const serviceCtx = serviceHost.ctx;
  const binding = await serviceCtx.resourceBindings.upsert({
    scope: { type: 'workspace', id: 'workspace-1' },
    resourceType: 'project',
    resourceId: 'project-1',
    displayName: 'Project 1',
  });

  const foundBinding = await serviceCtx.resourceBindings.get({
    scope: { type: 'workspace', id: 'workspace-1' },
    resourceType: 'project',
  });

  if (foundBinding?.id !== binding.id) {
    throw new Error('Resource binding helper must round-trip bindings.');
  }

  const dynamicResponse = await notesApi.get?.(serviceCtx);
  const dynamicPayload = (await dynamicResponse?.json()) as {
    projectId?: string;
    preview?: boolean;
    project?: { id?: string };
  };

  if (
    dynamicPayload.projectId !== 'project-1' ||
    dynamicPayload.preview !== true ||
    dynamicPayload.project?.id !== 'project-1'
  ) {
    throw new Error('Plugin request params/query and service mocks must be available in tests.');
  }

  if (!serviceHost.state.services.some((call) => call.service === 'core-api')) {
    throw new Error('Internal service calls must be recorded by the test host.');
  }

  if (!plugin.services?.some((service) => service.name === 'core-api')) {
    throw new Error('Internal sample plugin must declare its internal service contract.');
  }
});
