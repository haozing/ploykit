import { testPlugin } from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import storageProbeApi from '../api/storage-probe';

export default testPlugin(plugin, async ({ ctx, host }) => {
  if (!storageProbeApi.post) {
    throw new Error('Storage probe API must expose a POST handler.');
  }

  host.setRequest({
    method: 'POST',
    json: {
      source: 'plugin-doctor-test',
    },
  });

  const response = await storageProbeApi.post(ctx);
  const payload = await host.readJson<{
    ok: boolean;
    summary: {
      updatedStatus: string;
      readBackOk: boolean;
      deletedGone: boolean;
      statusFilterCount: number;
      nullFilterCount: number;
      inFilterCount: number;
      startsWithCount: number;
      containsCount: number;
      queryMode: string;
    };
  }>(response);

  if (response.status !== 200 || !payload.ok) {
    throw new Error(`Storage probe returned ${response.status}.`);
  }

  if (
    payload.summary.updatedStatus !== 'ready' ||
    !payload.summary.readBackOk ||
    !payload.summary.deletedGone ||
    payload.summary.statusFilterCount < 1 ||
    payload.summary.nullFilterCount < 1 ||
    payload.summary.inFilterCount < 1 ||
    payload.summary.startsWithCount < 1 ||
    payload.summary.containsCount < 1 ||
    payload.summary.queryMode !== 'database-filtered-jsonb'
  ) {
    throw new Error('Storage probe did not exercise the expected database capability surface.');
  }
});
