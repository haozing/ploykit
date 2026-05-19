import { describe, expect, it } from 'vitest';
import { apiRoutePatternMatches, resolveApiRoutePolicy } from '../api-route-catalog';
import {
  discoverAppApiRoutes,
  parseRouteMethods,
  validateApiRouteCatalog,
} from '../api-route-catalog-check.server';

describe('API route catalog', () => {
  it('matches dynamic and catch-all route patterns', () => {
    expect(apiRoutePatternMatches('/api/plans/[id]', '/api/plans/plan_123')).toBe(true);
    expect(apiRoutePatternMatches('/api/admin/**', '/api/admin/users/123')).toBe(true);
    expect(apiRoutePatternMatches('/api/plugins/[...slug]', '/api/plugins/demo/tasks/run')).toBe(
      true
    );
    expect(
      apiRoutePatternMatches('/api/plugins/[pluginId]/webhooks/**', '/api/plugins/demo/webhooks')
    ).toBe(true);
  });

  it('parses named and destructured route method exports', () => {
    const source = `
      export async function GET() {}
      export const POST = handler;
      export const { PUT, DELETE: remove } = handlers;
    `;

    expect(parseRouteMethods(source)).toEqual(['DELETE', 'GET', 'POST', 'PUT']);
  });

  it('classifies state-changing routes with a mutation strategy', () => {
    const policy = resolveApiRoutePolicy('/api/contact', 'POST');

    expect(policy?.access).toBe('public');
    expect(policy?.mutationProtection).toBe('rate-limit+csrf-origin');
  });

  it('classifies user file APIs as authenticated routes', () => {
    expect(resolveApiRoutePolicy('/api/files', 'GET')?.access).toBe('authenticated');
    expect(resolveApiRoutePolicy('/api/files/abc_123', 'DELETE')?.mutationProtection).toBe(
      'csrf-origin'
    );
  });

  it('classifies plugin webhooks separately from the plugin API gateway', () => {
    const policy = resolveApiRoutePolicy('/api/plugins/demo/webhooks/ingest', 'POST');

    expect(policy?.access).toBe('webhook');
    expect(policy?.mutationProtection).toBe('webhook-signature+rate-limit');
  });

  it('classifies signed plugin file transfers as plugin contract routes', () => {
    expect(resolveApiRoutePolicy('/api/plugin-files/file-1/download', 'GET')).toMatchObject({
      access: 'plugin-gateway',
      mutationProtection: 'plugin-contract',
    });
    expect(resolveApiRoutePolicy('/api/plugin-files/file-1/upload', 'PUT')).toMatchObject({
      access: 'plugin-gateway',
      mutationProtection: 'rate-limit+plugin-contract',
    });
  });

  it('classifies published plugin media as public read-only routes', () => {
    expect(resolveApiRoutePolicy('/api/plugin-media/demo/public-1/cover.png', 'GET')).toMatchObject(
      {
        access: 'public',
        mutationProtection: 'none',
      }
    );
  });

  it('classifies declared plugin assets as plugin contract routes', () => {
    expect(resolveApiRoutePolicy('/api/plugin-assets/demo/assets/icon.png', 'GET')).toMatchObject({
      access: 'plugin-gateway',
      mutationProtection: 'plugin-contract',
    });
  });

  it('covers all current app API route handlers', async () => {
    const routes = await discoverAppApiRoutes();
    const result = validateApiRouteCatalog(routes);

    expect(result.valid, result.issues.join('\n')).toBe(true);
  });
});
