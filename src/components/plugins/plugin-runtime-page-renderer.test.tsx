import { describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import type { PluginRuntimePageProps } from '@ploykit/plugin-sdk';
import type { PluginPageRuntimeResult } from '@/lib/plugin-runtime/adapters';
import { PluginRuntimePageRenderer } from './plugin-runtime-page-renderer';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
  redirect: vi.fn((location: string) => {
    throw new Error(`redirect:${location}`);
  }),
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PluginRuntimePageRenderer', () => {
  it('passes stable runtime props to plugin page components', async () => {
    const PluginPage: ComponentType<PluginRuntimePageProps> = () => null;
    const result = createRuntimeResult(PluginPage);

    const element = await PluginRuntimePageRenderer({ result });
    const child = element.props.children;

    expect(child.type).toBe(PluginPage);
    expect(child.props).toEqual({
      pluginId: 'runtime-props',
      localPath: '/reports/weekly',
      requestPath: '/plugins/runtime-props/reports/weekly',
      params: { period: 'weekly' },
      query: { tab: 'summary' },
      data: { title: 'Weekly report' },
      i18n: {
        locale: 'zh',
        messages: {},
      },
      assets: {},
      route: {
        path: '/reports/:period',
        auth: 'auth',
        layout: 'dashboard',
        permissions: ['storage.read.self'],
        commercial: {
          plan: 'pro',
        },
        publicAliases: [{ path: '/reports/:period' }],
      },
    });
  });
});

function createRuntimeResult(
  PluginPage: ComponentType<PluginRuntimePageProps>
): PluginPageRuntimeResult {
  return {
    contract: {
      id: 'runtime-props',
      name: 'Runtime Props',
      version: '1.0.0',
      kind: 'app',
      trustLevel: 'untrusted',
      permissions: ['storage.read.self'],
      menu: [],
      slots: {},
      hostPages: { slots: [], overrides: [] },
      resources: {},
      events: { publishes: [], subscribes: {} },
      jobs: {},
      webhooks: {},
      hooks: {},
      meters: [],
      serviceRequirements: [],
      resourceBindings: [],
      egress: [],
      definition: {
        id: 'runtime-props',
        name: 'Runtime Props',
        version: '1.0.0',
      },
      routes: {
        pages: [],
        apis: [],
        all: [],
      },
      lifecycle: {},
    },
    route: {
      kind: 'page',
      path: '/reports/:period',
      component: './pages/Report',
      auth: 'auth',
      layout: 'dashboard',
      area: 'public',
      permissions: ['storage.read.self'],
      commercial: {
        plan: 'pro',
      },
      publicAliases: [{ path: '/reports/:period' }],
    },
    localPath: '/reports/weekly',
    requestPath: '/plugins/runtime-props/reports/weekly',
    locale: 'zh',
    params: { period: 'weekly' },
    query: { tab: 'summary' },
    data: { title: 'Weekly report' },
    module: {
      componentPath: './pages/Report',
      load: async () => ({ default: PluginPage }),
    },
  };
}
