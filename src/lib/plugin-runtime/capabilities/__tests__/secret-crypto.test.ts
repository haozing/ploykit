import { describe, expect, it } from 'vitest';
import {
  decryptPluginSecret,
  encryptPluginSecret,
  PLUGIN_SECRET_ENCODING,
} from '../secret-crypto.server';

describe('plugin secret crypto', () => {
  it('stores plugin secrets as authenticated ciphertext', () => {
    const scope = { pluginId: 'crypto-test', userId: 'user-1', name: 'api-key' };

    const encrypted = encryptPluginSecret('secret-value', scope);

    expect(encrypted.encoding).toBe(PLUGIN_SECRET_ENCODING);
    expect(encrypted.valueCiphertext).not.toContain('secret-value');
    expect(decryptPluginSecret(encrypted.valueCiphertext, encrypted.encoding, scope)).toBe(
      'secret-value'
    );
  });

  it('binds ciphertext to plugin, user, and secret name', () => {
    const encrypted = encryptPluginSecret('secret-value', {
      pluginId: 'crypto-test',
      userId: 'user-1',
      name: 'api-key',
    });

    expect(() =>
      decryptPluginSecret(encrypted.valueCiphertext, encrypted.encoding, {
        pluginId: 'crypto-test',
        userId: 'user-2',
        name: 'api-key',
      })
    ).toThrow();
  });
});
