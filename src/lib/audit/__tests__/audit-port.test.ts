import { describe, expect, it, vi } from 'vitest';

import {
  DatabaseAuditPort,
  MemoryAuditPort,
  sanitizeAuditDetails,
  type AuditEvent,
} from '../audit-port.server';

function createAuditEvent(details: Record<string, unknown>): AuditEvent {
  return {
    id: 'audit-1',
    type: 'admin.action',
    action: 'admin.test',
    actorId: 'admin-1',
    actorType: 'user',
    targetId: 'target-1',
    targetType: 'system',
    details,
    timestamp: new Date('2026-05-09T00:00:00.000Z'),
  };
}

describe('sanitizeAuditDetails', () => {
  it('redacts sensitive keys recursively', () => {
    expect(
      sanitizeAuditDetails({
        authorization: 'Bearer secret',
        nested: {
          apiKey: 'api-key',
          headers: {
            cookie: 'session=secret',
            'stripe-signature': 'sig',
          },
        },
        items: [{ password: 'pw' }, { ok: true }],
      })
    ).toEqual({
      authorization: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        headers: {
          cookie: '[REDACTED]',
          'stripe-signature': '[REDACTED]',
        },
      },
      items: [{ password: '[REDACTED]' }, { ok: true }],
    });
  });
});

describe('MemoryAuditPort', () => {
  it('stores sanitized events for queries', async () => {
    const port = new MemoryAuditPort();

    await port.log(createAuditEvent({ token: 'secret', nested: { password: 'pw' } }));

    const [event] = await port.query({});
    expect(event.details).toEqual({
      token: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });
  });
});

describe('DatabaseAuditPort', () => {
  it('writes sanitized metadata details', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const database = {
      insert: vi.fn(() => ({ values })),
    };
    const port = new DatabaseAuditPort(database as never);

    await port.log(createAuditEvent({ webhookSignature: 'sig', nested: { secret: 'secret' } }));

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          details: {
            webhookSignature: '[REDACTED]',
            nested: { secret: '[REDACTED]' },
          },
        }),
      })
    );
  });
});
