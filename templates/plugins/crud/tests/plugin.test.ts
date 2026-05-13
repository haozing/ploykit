import { testPlugin } from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import itemsApi from '../api/items';
import itemDetailApi from '../api/item-detail';
import install from '../lifecycle/install';
import CrudPage from '../pages/CrudPage';

export default testPlugin(plugin, async ({ ctx, host, plugin }) => {
  if (plugin.id !== ctx.plugin.id) {
    throw new Error('Test context plugin id does not match the contract.');
  }

  if (!plugin.routes?.apis || plugin.routes.apis.length < 2) {
    throw new Error('CRUD template must declare list and detail API routes.');
  }

  if (!plugin.data?.collections?.crud_template_items) {
    throw new Error('CRUD template must declare its storage collection.');
  }

  if (typeof CrudPage !== 'function') {
    throw new Error('CRUD template page must export a component.');
  }

  await install(ctx);
  await install(ctx);
  const installAudits = host.state.audit.filter((record) => record.action === 'crud.installed');
  if (installAudits.length !== 1) {
    throw new Error('CRUD install lifecycle must be idempotent and record one audit event.');
  }

  host.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/plugins/crud/api/items',
    json: { title: 'Alpha', status: 'active' },
  });

  const createResponse = await itemsApi.post?.(ctx);
  if (!createResponse || createResponse.status !== 201) {
    throw new Error('CRUD create API must return HTTP 201.');
  }

  const created = await host.readJson<{ item: { id: string; title: string } }>(createResponse);
  if (created.item.title !== 'Alpha') {
    throw new Error('CRUD create API must persist the submitted title.');
  }

  if (!host.state.events.some((event) => event.event === 'crud.item.created')) {
    throw new Error('CRUD create API must emit crud.item.created.');
  }

  const listResponse = await itemsApi.get?.(ctx);
  const listed = await host.readJson<{ items: Array<{ id: string }> }>(listResponse);
  if (listed.items.length !== 1) {
    throw new Error('CRUD list API must read from fake storage.');
  }

  host.setRequest({
    method: 'PATCH',
    url: `https://ploykit.test/plugins/crud/api/item?id=${created.item.id}`,
    json: { status: 'archived' },
  });
  await itemDetailApi.patch?.(ctx);

  const [updated] = host.getCollection<{ id: string; status: string }>('crud_template_items');
  if (updated?.status !== 'archived') {
    throw new Error('CRUD detail API must update fake storage.');
  }

  await itemDetailApi.delete?.(ctx);
  if (host.getCollection('crud_template_items').length !== 0) {
    throw new Error('CRUD delete API must remove fake storage records.');
  }
});
