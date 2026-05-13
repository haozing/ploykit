import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insertMock, valuesMock, returningMock } = vi.hoisted(() => {
  const returningMock = vi.fn();
  const valuesMock = vi.fn(() => ({ returning: returningMock }));
  const insertMock = vi.fn(() => ({ values: valuesMock }));

  return { insertMock, valuesMock, returningMock };
});

vi.mock('@/lib/db', () => ({
  db: {
    insert: insertMock,
  },
}));

import { AUDIT_ACTIONS, auditLogDurable } from '../audit-service';

describe('audit service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    returningMock.mockResolvedValue([{ id: 'audit-row-1' }]);
  });

  it('sanitizes metadata before durable database writes', async () => {
    await auditLogDurable({
      userId: 'admin-1',
      action: AUDIT_ACTIONS.SYSTEM_CONFIG_UPDATE,
      resource: 'system',
      status: 'success',
      metadata: {
        before: { apiToken: 'old-token' },
        after: {
          webhook: {
            signingSecret: 'new-secret',
            headers: {
              authorization: 'Bearer token',
              cookie: 'session=value',
            },
          },
        },
      },
    });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          before: { apiToken: '[REDACTED]' },
          after: {
            webhook: {
              signingSecret: '[REDACTED]',
              headers: {
                authorization: '[REDACTED]',
                cookie: '[REDACTED]',
              },
            },
          },
        },
      })
    );
  });
});
