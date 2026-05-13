import { describe, expect, it } from 'vitest';
import {
  createPluginFileSignedUrl,
  verifyPluginFileSignedUrl,
} from '../plugin-file-signing.server';
import type { PluginFile } from '@/lib/db/schema/plugin-platform';

function createFile(overrides: Partial<PluginFile> = {}): PluginFile {
  const now = new Date('2026-05-11T00:00:00.000Z');
  return {
    id: 'file-1',
    pluginId: 'demo-plugin',
    userId: 'user-1',
    scopeType: 'workspace',
    scopeId: 'workspace-1',
    ownerUserId: 'user-1',
    fileName: 'result.pdf',
    contentType: 'application/pdf',
    size: 1024,
    hash: null,
    purpose: 'result',
    status: 'ready',
    storageKey: 'plugins/demo/workspace/workspace-1/file-1/result.pdf',
    storageProvider: 'local',
    runId: 'run-1',
    metadata: {},
    expiresAt: null,
    uploadedAt: now,
    archivedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('plugin file signed URLs', () => {
  it('creates and verifies a scoped signed URL', () => {
    const file = createFile();
    const url = createPluginFileSignedUrl({
      file,
      operation: 'download',
      expiresInSeconds: 600,
    });
    const parsed = new URL(url, 'https://ploykit.test');

    expect(parsed.pathname).toBe('/api/plugin-files/file-1/download');
    expect(parsed.searchParams.get('expires')).toBeTruthy();
    expect(parsed.searchParams.get('signature')).toBeTruthy();

    expect(
      verifyPluginFileSignedUrl({
        file,
        operation: 'download',
        expires: parsed.searchParams.get('expires'),
        signature: parsed.searchParams.get('signature'),
        now: new Date('2026-05-11T00:00:00.000Z'),
      })
    ).toMatchObject({ ok: true });
  });

  it('rejects signatures for the wrong operation or expired URLs', () => {
    const file = createFile();
    const url = createPluginFileSignedUrl({
      file,
      operation: 'upload',
      expiresInSeconds: 1,
    });
    const parsed = new URL(url, 'https://ploykit.test');

    expect(
      verifyPluginFileSignedUrl({
        file,
        operation: 'download',
        expires: parsed.searchParams.get('expires'),
        signature: parsed.searchParams.get('signature'),
        now: new Date('2026-05-11T00:00:00.000Z'),
      })
    ).toEqual({ ok: false, reason: 'invalid_signature' });

    expect(
      verifyPluginFileSignedUrl({
        file,
        operation: 'upload',
        expires: parsed.searchParams.get('expires'),
        signature: parsed.searchParams.get('signature'),
        now: new Date(Date.now() + 10_000),
      })
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects URLs after the file-level expiry', () => {
    const file = createFile({
      expiresAt: new Date('2026-05-11T00:01:00.000Z'),
    });
    const url = createPluginFileSignedUrl({
      file,
      operation: 'download',
      expiresInSeconds: 600,
    });
    const parsed = new URL(url, 'https://ploykit.test');

    expect(
      verifyPluginFileSignedUrl({
        file,
        operation: 'download',
        expires: parsed.searchParams.get('expires'),
        signature: parsed.searchParams.get('signature'),
        now: new Date('2026-05-11T00:02:00.000Z'),
      })
    ).toEqual({ ok: false, reason: 'expired' });
  });
});
