import { testPlugin } from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import runApi from '../api/run';
import ToolPage from '../pages/ToolPage';

export default testPlugin(plugin, async ({ ctx, host, plugin }) => {
  if (plugin.id !== ctx.plugin.id) {
    throw new Error('Test context plugin id does not match the contract.');
  }

  if (plugin.kind !== 'tool') {
    throw new Error('Tool template must declare kind "tool".');
  }

  if (!plugin.routes?.apis?.some((route) => route.path.endsWith('/run'))) {
    throw new Error('Tool template must expose a run API.');
  }

  if (typeof ToolPage !== 'function') {
    throw new Error('Tool template page must export a component.');
  }

  host.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/plugins/tool/api/run',
    json: { input: '  hello  ' },
  });

  const response = await runApi.post?.(ctx);
  const body = await host.readJson<{ result: string }>(response);

  if (body.result !== 'hello') {
    throw new Error('Tool run API must trim and return the submitted input.');
  }

  if (!host.state.audit.some((record) => record.action === 'tool.run')) {
    throw new Error('Tool run API must record audit.');
  }

  if (!host.state.usage.some((record) => record.metric === 'tool_template.runs')) {
    throw new Error('Tool run API must record usage.');
  }
});
