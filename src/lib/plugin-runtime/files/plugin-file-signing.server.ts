import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigurationError } from '@/lib/_core/errors';
import { env } from '@/lib/_core/env';
import type { PluginFile } from '@/lib/db/schema/plugin-platform';

export type PluginFileSignedOperation = 'upload' | 'download';

export type PluginFileSignedUrlVerification =
  | { ok: true; expiresAt: Date }
  | {
      ok: false;
      reason: 'missing_signature' | 'invalid_expires' | 'expired' | 'invalid_signature';
    };

const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 300;
const MAX_SIGNED_URL_EXPIRES_IN_SECONDS = 24 * 60 * 60;
const DEV_SIGNING_SECRET = 'dev-plugin-file-signing-secret';

function getSigningSecret(): string {
  const secret = env.PLUGIN_FILE_SIGNING_SECRET?.trim();
  if (secret) {
    return secret;
  }

  if (env.NODE_ENV === 'production') {
    throw new ConfigurationError(
      'PLUGIN_FILE_SIGNING_SECRET is required in production for plugin file signed URLs.'
    );
  }

  return DEV_SIGNING_SECRET;
}

function normalizeExpiresInSeconds(value?: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS;
  }

  return Math.min(Math.max(Math.floor(value), 1), MAX_SIGNED_URL_EXPIRES_IN_SECONDS);
}

function createPayload(input: {
  file: Pick<PluginFile, 'pluginId' | 'id' | 'scopeType' | 'scopeId'>;
  operation: PluginFileSignedOperation;
  expires: string;
}): string {
  return [
    input.file.pluginId,
    input.file.id,
    input.file.scopeType,
    input.file.scopeId,
    input.operation,
    input.expires,
  ].join('\n');
}

function signPayload(payload: string): string {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function resolveExpiresAt(file: Pick<PluginFile, 'expiresAt'>, expiresInSeconds?: number): Date {
  const requested = new Date(Date.now() + normalizeExpiresInSeconds(expiresInSeconds) * 1000);

  if (file.expiresAt && file.expiresAt.getTime() < requested.getTime()) {
    return file.expiresAt;
  }

  return requested;
}

export function createPluginFileSignedUrl(input: {
  file: PluginFile;
  operation: PluginFileSignedOperation;
  expiresInSeconds?: number;
  basePath?: string;
}): string {
  const expiresAt = resolveExpiresAt(input.file, input.expiresInSeconds);
  const expires = expiresAt.toISOString();
  const signature = signPayload(
    createPayload({
      file: input.file,
      operation: input.operation,
      expires,
    })
  );
  const basePath = input.basePath ?? '/api/plugin-files';
  const params = new URLSearchParams({
    expires,
    signature,
  });

  return `${basePath}/${encodeURIComponent(input.file.id)}/${input.operation}?${params.toString()}`;
}

export function verifyPluginFileSignedUrl(input: {
  file: PluginFile;
  operation: PluginFileSignedOperation;
  expires: string | null;
  signature: string | null;
  now?: Date;
}): PluginFileSignedUrlVerification {
  if (!input.expires || !input.signature) {
    return { ok: false, reason: 'missing_signature' };
  }

  const expiresAt = new Date(input.expires);
  if (!Number.isFinite(expiresAt.getTime())) {
    return { ok: false, reason: 'invalid_expires' };
  }

  const canonicalExpires = expiresAt.toISOString();
  const now = input.now ?? new Date();
  const fileExpiresAt = input.file.expiresAt;
  if (
    expiresAt.getTime() <= now.getTime() ||
    (fileExpiresAt && fileExpiresAt.getTime() <= now.getTime())
  ) {
    return { ok: false, reason: 'expired' };
  }

  const expected = signPayload(
    createPayload({
      file: input.file,
      operation: input.operation,
      expires: canonicalExpires,
    })
  );

  if (!safeEqual(input.signature, expected)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  return { ok: true, expiresAt };
}
