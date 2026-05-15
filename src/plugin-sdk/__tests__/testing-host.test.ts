import { describe, expect, it } from 'vitest';
import { definePlugin } from '../define-plugin';
import { Permission } from '../permissions';
import { createPluginTestHost } from '../testing';

describe('createPluginTestHost platform helpers', () => {
  it('supports request params, query, resource bindings, and internal services', async () => {
    const plugin = definePlugin({
      id: 'testing-host',
      name: 'Testing Host',
      version: '1.0.0',
      permissions: [
        Permission.ResourceBindingsRead,
        Permission.ResourceBindingsWrite,
        Permission.ServicesInvoke,
      ],
      resourceBindings: [{ type: 'project', scope: 'workspace', cardinality: 'one' }],
      services: [{ name: 'core-api', methods: ['GET'], paths: ['/v1/projects/:projectId'] }],
    });
    const host = createPluginTestHost(plugin, {
      params: { projectId: 'project-1' },
      query: { preview: true },
      services: {
        'core-api': async (request) =>
          Response.json({
            id: request.path.split('/').at(-1),
            limit: request.query.get('limit'),
          }),
      },
    });

    expect(host.ctx.request.params.projectId).toBe('project-1');
    expect(host.ctx.request.query.get('preview')).toBe('true');

    const binding = await host.ctx.resourceBindings.upsert({
      scope: { type: 'workspace', id: 'workspace-1' },
      resourceType: 'project',
      resourceId: 'project-1',
    });
    await host.ctx.resourceBindings.upsert({
      scope: { type: 'workspace', id: 'workspace-1' },
      resourceType: 'project',
      resourceId: 'project-2',
    });

    expect(binding.resourceId).toBe('project-1');
    expect(binding.cardinality).toBe('one');
    await expect(
      host.ctx.resourceBindings.get({
        scope: { type: 'workspace', id: 'workspace-1' },
        resourceType: 'project',
      })
    ).resolves.toMatchObject({ resourceId: 'project-2' });

    await expect(
      host.ctx.services.json('core-api', {
        template: '/v1/projects/:projectId',
        params: { projectId: 'project-2' },
        query: { limit: 10 },
      })
    ).resolves.toEqual({ id: 'project-2', limit: '10' });
    expect(host.state.services).toEqual([
      { service: 'core-api', path: '/v1/projects/project-2', method: 'GET', status: 200 },
    ]);
  });
});
