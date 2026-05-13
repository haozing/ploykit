import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '@/lib/_core/env';

export const PLUGIN_SECRET_ENCODING = 'aes-256-gcm-v1';

interface PluginSecretCryptoScope {
  pluginId: string;
  userId: string;
  name: string;
}

export interface EncryptedPluginSecret {
  valueCiphertext: string;
  encoding: typeof PLUGIN_SECRET_ENCODING;
}

export interface PluginSecretCryptoStatus {
  encoding: typeof PLUGIN_SECRET_ENCODING;
  keySource: 'env' | 'development-fallback';
  productionReady: boolean;
}

function getNodeEnv(): string {
  return env.NODE_ENV;
}

function resolveKeyMaterial(): { material: string; source: PluginSecretCryptoStatus['keySource'] } {
  const explicit = env.PLUGIN_SECRET_ENCRYPTION_KEY?.trim();

  if (explicit) {
    return { material: explicit, source: 'env' };
  }

  if (getNodeEnv() === 'production') {
    throw new Error(
      'PLUGIN_SECRET_ENCRYPTION_KEY is required in production for encrypted plugin secrets.'
    );
  }

  return {
    material: `ploykit:${process.cwd()}:development-plugin-secrets`,
    source: 'development-fallback',
  };
}

function normalizeKey(material: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(material)) {
    return Buffer.from(material, 'hex');
  }

  const base64 = Buffer.from(material, 'base64');
  if (base64.length === 32 && /^[A-Za-z0-9+/=_-]+$/.test(material)) {
    return base64;
  }

  return createHash('sha256').update(material).digest();
}

function createAad(scope: PluginSecretCryptoScope): Buffer {
  return Buffer.from(`${scope.pluginId}\0${scope.userId}\0${scope.name}`, 'utf-8');
}

function resolveKey(): { key: Buffer; source: PluginSecretCryptoStatus['keySource'] } {
  const { material, source } = resolveKeyMaterial();
  return {
    key: normalizeKey(material),
    source,
  };
}

export function getPluginSecretCryptoStatus(): PluginSecretCryptoStatus {
  const { source } = resolveKeyMaterial();
  return {
    encoding: PLUGIN_SECRET_ENCODING,
    keySource: source,
    productionReady: source === 'env',
  };
}

export function encryptPluginSecret(
  value: string,
  scope: PluginSecretCryptoScope
): EncryptedPluginSecret {
  const { key } = resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(createAad(scope));

  const ciphertext = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encoding: PLUGIN_SECRET_ENCODING,
    valueCiphertext: [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.'),
  };
}

export function decryptPluginSecret(
  valueCiphertext: string,
  encoding: string,
  scope: PluginSecretCryptoScope
): string {
  if (encoding === 'plaintext-v1') {
    return valueCiphertext;
  }

  if (encoding !== PLUGIN_SECRET_ENCODING) {
    throw new Error(`Unsupported plugin secret encoding: ${encoding}`);
  }

  const [ivPart, tagPart, ciphertextPart] = valueCiphertext.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Encrypted plugin secret payload is malformed.');
  }

  const { key } = resolveKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAAD(createAad(scope));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf-8');
}
