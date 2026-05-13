import { testPlugin } from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import summaryApi from '../api/summary';
import DashboardPage from '../pages/DashboardPage';

export default testPlugin(plugin, async ({ ctx, host, plugin }) => {
  if (plugin.id !== ctx.plugin.id) {
    throw new Error('Test context plugin id does not match the contract.');
  }

  if (!plugin.data?.collections?.dashboard_template_metrics) {
    throw new Error('Dashboard template must declare a metrics collection.');
  }

  if (!plugin.routes?.pages?.some((route) => route.layout === 'dashboard')) {
    throw new Error('Dashboard template must declare a dashboard page.');
  }

  if (typeof DashboardPage !== 'function') {
    throw new Error('Dashboard template page must export a component.');
  }

  host.seedCollection('dashboard_template_metrics', {
    name: 'active_users',
    value: 4,
    captured_at: new Date().toISOString(),
  });

  const response = await summaryApi.get?.(ctx);
  const body = await host.readJson<{ metrics: unknown[]; total: number }>(response);

  if (body.metrics.length !== 1 || body.total !== 4) {
    throw new Error('Dashboard summary API must read and aggregate fake storage metrics.');
  }
});
