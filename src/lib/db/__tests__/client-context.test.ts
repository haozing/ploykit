import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb, mockTx, mockPostgresClient } = vi.hoisted(() => {
  const mockTx = {
    execute: vi.fn(),
    query: {
      userProfiles: {
        findFirst: vi.fn(),
      },
    },
  };

  return {
    mockTx,
    mockPostgresClient: {
      end: vi.fn(),
    },
    mockDb: {
      execute: vi.fn(),
      transaction: vi.fn(async (callback) => callback(mockTx)),
    },
  };
});

vi.mock('../config.server', () => ({
  getDatabaseConfig: () => ({
    provider: 'postgres',
    connectionString: 'postgres://test',
    options: {},
  }),
}));

vi.mock('../schema', () => ({}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: Array.from(strings).join('$'),
    values,
  })),
}));

vi.mock('postgres', () => ({
  default: vi.fn(() => mockPostgresClient),
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => mockDb),
}));

vi.mock('drizzle-orm/neon-http', () => ({
  drizzle: vi.fn(() => mockDb),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(),
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('database context helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__dbInstance = undefined;
    globalThis.__postgresClient = undefined;
  });

  it('rejects required user context without a userId', async () => {
    const { requireUserContext } = await import('../client.server');

    await expect(requireUserContext(undefined, async () => 'ok')).rejects.toThrow(
      'User context is required'
    );
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('sets user context before invoking the callback', async () => {
    const { requireUserContext } = await import('../client.server');
    const callback = vi.fn(async () => 'ok');

    const result = await requireUserContext('user_1', callback);

    expect(result).toBe('ok');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenCalledWith({
      text: "SELECT set_config('app.current_user_id', $, true)",
      values: ['user_1'],
    });
    expect(callback).toHaveBeenCalledWith(mockTx);
  });

  it('routes global db proxy calls through the active user transaction', async () => {
    const { db, requireUserContext } = await import('../client.server');
    mockTx.query.userProfiles.findFirst.mockResolvedValue({ id: 'profile_1' });

    const result = await requireUserContext('user_1', async () => {
      return await db.query.userProfiles.findFirst();
    });

    expect(result).toEqual({ id: 'profile_1' });
    expect(mockTx.query.userProfiles.findFirst).toHaveBeenCalledTimes(1);
  });

  it('sets system context before invoking the callback', async () => {
    const { withSystemContext } = await import('../client.server');
    const callback = vi.fn(async () => 'ok');

    const result = await withSystemContext(callback);

    expect(result).toBe('ok');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenCalledWith({
      text: "SELECT set_config('app.current_user_id', 'system', true)",
      values: [],
    });
    expect(callback).toHaveBeenCalledWith(mockTx);
  });

  it('requires plugin id and user id for user plugin context', async () => {
    const { withPluginContext } = await import('../client.server');

    await expect(withPluginContext('', 'user_1', async () => 'ok')).rejects.toThrow(
      'Plugin context requires a pluginId'
    );
    await expect(withPluginContext('plugin_1', undefined, async () => 'ok')).rejects.toThrow(
      'User context is required for plugin database operations'
    );
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('sets user and plugin context before invoking a plugin callback', async () => {
    const { withPluginContext } = await import('../client.server');
    const callback = vi.fn(async () => 'ok');

    const result = await withPluginContext('plugin_1', 'user_1', callback);

    expect(result).toBe('ok');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenNthCalledWith(1, {
      text: "SELECT set_config('app.current_user_id', $, true)",
      values: ['user_1'],
    });
    expect(mockTx.execute).toHaveBeenNthCalledWith(2, {
      text: "SELECT set_config('app.current_plugin_id', $, true)",
      values: ['plugin_1'],
    });
    expect(callback).toHaveBeenCalledWith(mockTx);
  });

  it('allows system plugin context without a user id', async () => {
    const { withPluginContext } = await import('../client.server');
    const callback = vi.fn(async () => 'ok');

    const result = await withPluginContext('plugin_1', undefined, callback, { system: true });

    expect(result).toBe('ok');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenNthCalledWith(1, {
      text: "SELECT set_config('app.current_user_id', $, true)",
      values: ['system'],
    });
    expect(mockTx.execute).toHaveBeenNthCalledWith(2, {
      text: "SELECT set_config('app.current_plugin_id', $, true)",
      values: ['plugin_1'],
    });
    expect(callback).toHaveBeenCalledWith(mockTx);
  });
});
