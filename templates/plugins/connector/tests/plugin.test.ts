import { testPlugin } from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import settingsApi from '../api/settings';
import sync from '../jobs/sync';
import ingest from '../webhooks/ingest';

export default testPlugin(plugin, async ({ ctx, host, plugin }) => {
  if (plugin.id !== ctx.plugin.id) {
    throw new Error('Test context plugin id does not match the contract.');
  }

  if (plugin.kind !== 'connector') {
    throw new Error('Connector template must declare kind "connector".');
  }

  if (!plugin.webhooks?.ingest || !plugin.jobs?.['connector.sync']) {
    throw new Error('Connector template must declare ingest webhook and sync job.');
  }

  host.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/plugins/connector/api/settings',
    json: { endpoint: 'https://api.example.com', apiKey: 'secret' },
  });

  const saveResponse = await settingsApi.post?.(ctx);
  const saveBody = await host.readJson<{ saved: boolean }>(saveResponse);
  if (!saveBody.saved) {
    throw new Error('Connector settings API must save config and secrets.');
  }

  const readResponse = await settingsApi.get?.(ctx);
  const readBody = await host.readJson<{ endpoint: string; hasApiKey: boolean }>(readResponse);
  if (readBody.endpoint !== 'https://api.example.com' || !readBody.hasApiKey) {
    throw new Error('Connector settings API must read saved config and secrets.');
  }

  await sync(ctx);
  if (!host.state.audit.some((record) => record.action === 'connector.sync.completed')) {
    throw new Error('Connector sync job must record audit.');
  }

  const webhookResponse = await ingest(ctx);
  if (webhookResponse.status !== 202) {
    throw new Error('Connector webhook must return accepted.');
  }

  if (!host.state.webhookVerifications.some((item) => item.policy === 'hmac-sha256')) {
    throw new Error('Connector webhook must verify hmac-sha256 signatures.');
  }

  if (!host.state.events.some((event) => event.event === 'connector.received')) {
    throw new Error('Connector webhook must emit connector.received.');
  }
});
