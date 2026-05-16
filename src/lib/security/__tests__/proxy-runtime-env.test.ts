import { afterEach, describe, expect, it, vi } from 'vitest';
import { readProxyRuntimeEnv } from '../proxy-runtime-env';

describe('proxy runtime env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the explicit Next runtime environment when present', () => {
    vi.stubEnv('NODE_ENV', 'test');

    expect(readProxyRuntimeEnv().nodeEnv).toBe('test');
  });

  it('defaults to production when NODE_ENV is unavailable or invalid', () => {
    vi.stubEnv('NODE_ENV', 'staging');

    expect(readProxyRuntimeEnv().nodeEnv).toBe('production');
  });
});
