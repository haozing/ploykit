import { testPlugin } from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import healthApi from '../api/health';
import requested from '../events/requested';
import worker from '../jobs/worker';
import enable from '../lifecycle/enable';

export default testPlugin(plugin, async ({ ctx, host, plugin }) => {
  if (plugin.id !== ctx.plugin.id) {
    throw new Error('Test context plugin id does not match the contract.');
  }

  if (plugin.kind !== 'service') {
    throw new Error('Service template must declare kind "service".');
  }

  if (!plugin.jobs?.['service.worker'] || !plugin.events?.subscribes?.['service.requested']) {
    throw new Error('Service template must declare a worker job and event subscription.');
  }

  const healthResponse = await healthApi.get?.(ctx);
  const health = await host.readJson<{ ok: boolean; pluginId: string }>(healthResponse);
  if (!health.ok || health.pluginId !== 'service') {
    throw new Error('Service health API must return plugin identity.');
  }

  if (!host.state.usage.some((record) => record.metric === 'service_template.health.checked')) {
    throw new Error('Service health API must record usage.');
  }

  await enable(ctx);
  await enable(ctx);
  const enableAudits = host.state.audit.filter((record) => record.action === 'service.enabled');
  if (enableAudits.length !== 1) {
    throw new Error('Service enable lifecycle must be idempotent and record one audit event.');
  }

  await requested(ctx);
  if (!host.state.jobs.some((job) => job.name === 'service.worker')) {
    throw new Error('Service event handler must enqueue the worker job.');
  }

  await worker(ctx);
  if (!host.state.events.some((event) => event.event === 'service.completed')) {
    throw new Error('Service worker job must emit service.completed.');
  }
});
