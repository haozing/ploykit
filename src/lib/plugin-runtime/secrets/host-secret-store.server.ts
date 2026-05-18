import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, withSystemContext, type Database } from '@/lib/db/client.server';
import { hostSecrets } from '@/lib/db/schema/plugin-platform';
import {
  decryptPluginSecret,
  encryptPluginSecret,
  PLUGIN_SECRET_ENCODING,
} from '../capabilities/secret-crypto.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface HostSecretStore {
  get(name: string): Promise<string | null>;
  set(input: { name?: string; value: string; createdByUserId?: string }): Promise<string>;
}

const HOST_SECRET_NAMESPACE = 'service-connections';
const HOST_SECRET_CRYPTO_PLUGIN_ID = 'host';
const HOST_SECRET_CRYPTO_USER_ID = 'system';

function normalizeSecretName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 300) {
    throw new Error('Host secret name must be between 1 and 300 characters.');
  }
  if (!/^[a-zA-Z0-9._:/-]+$/.test(normalized)) {
    throw new Error('Host secret name contains unsupported characters.');
  }
  return normalized;
}

function generatedSecretName(): string {
  return `${HOST_SECRET_NAMESPACE}/${randomUUID()}`;
}

function cryptoScope(name: string) {
  return {
    pluginId: HOST_SECRET_CRYPTO_PLUGIN_ID,
    userId: HOST_SECRET_CRYPTO_USER_ID,
    name,
  };
}

export class DbHostSecretStore implements HostSecretStore {
  constructor(private readonly executor: Executor = db) {}

  async get(name: string): Promise<string | null> {
    const secretName = normalizeSecretName(name);
    const read = async (executor: Executor) =>
      executor
        .select()
        .from(hostSecrets)
        .where(
          and(eq(hostSecrets.namespace, HOST_SECRET_NAMESPACE), eq(hostSecrets.name, secretName))
        )
        .limit(1);
    const rows = this.executor !== db ? await read(this.executor) : await withSystemContext(read);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return decryptPluginSecret(row.valueCiphertext, row.encoding, cryptoScope(secretName));
  }

  async set(input: { name?: string; value: string; createdByUserId?: string }): Promise<string> {
    const secretName = normalizeSecretName(input.name ?? generatedSecretName());
    const encrypted = encryptPluginSecret(input.value, cryptoScope(secretName));
    const now = new Date();

    const write = async (executor: Executor) => {
      await executor
        .insert(hostSecrets)
        .values({
          id: `${HOST_SECRET_NAMESPACE}:${secretName}`,
          namespace: HOST_SECRET_NAMESPACE,
          name: secretName,
          valueCiphertext: encrypted.valueCiphertext,
          encoding: PLUGIN_SECRET_ENCODING,
          createdByUserId: input.createdByUserId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [hostSecrets.namespace, hostSecrets.name],
          set: {
            valueCiphertext: encrypted.valueCiphertext,
            encoding: PLUGIN_SECRET_ENCODING,
            updatedAt: now,
          },
        });
    };

    if (this.executor !== db) {
      await write(this.executor);
    } else {
      await withSystemContext(write);
    }

    return secretName;
  }
}
