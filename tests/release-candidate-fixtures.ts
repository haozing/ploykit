import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ploykit-rc-gate-'));
}
export function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

export function providerInvocationEvidence() {
  return {
    domainEvidence: {
      providerInvocationLedger: {
        invocations: 6,
        successful: 6,
        failed: 0,
        operations: ['contextPack', 'delete', 'embedText', 'generateText', 'index', 'search'],
        kinds: ['ai', 'rag'],
        ragSources: 1,
        ragChunks: 2,
        connectorInvocations: 1,
      },
    },
  };
}

export function workerSoakEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    required: true,
    checkedAt: '2026-05-23T00:00:00.000Z',
    enqueued: 3,
    drain: {
      iterations: 1,
      processed: 3,
      failed: 0,
      deadLettered: 0,
    },
    deliveryLedger: {
      records: 4,
      delivered: 4,
      failed: 0,
      deadLettered: 0,
      workerRecords: 1,
      workers: 3,
    },
    workerRegistry: {
      workers: 1,
      activeWorkers: 1,
      errorWorkers: 0,
      latestHeartbeatAt: '2026-05-23T00:00:00.000Z',
    },
    ...overrides,
  };
}
