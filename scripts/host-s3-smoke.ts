import {
  randomUUID } from 'node:crypto';
import {
  createS3CompatibleHttpClient,
} from '../src/lib/module-runtime';
import {
  createS3CompatibleModuleFileStorage,
} from '../src/lib/module-capabilities';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readBooleanArg(name: string): boolean {
  return process.argv.includes(name);
}

function requiredEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}

function missingEnv(): string[] {
  return ['S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(
    (name) => !requiredEnv(name)
  );
}

const required = readBooleanArg('--required');
const checkSignedUrl = readBooleanArg('--check-signed-url');
const missing = missingEnv();

if (missing.length > 0) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: !required,
        skipped: true,
        reason: 'S3 env is not configured.',
        missing,
        checkedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  );
  process.exitCode = required ? 1 : 0;
  process.exit();
}

const bucket = requiredEnv('S3_BUCKET')!;
const endpoint = requiredEnv('S3_ENDPOINT')!;
const key = readArg('--key') ?? `ploykit-smoke/${Date.now()}-${randomUUID()}.txt`;
const bodyText = `ploykit-s3-smoke ${new Date().toISOString()}\n`;
const storage = createS3CompatibleModuleFileStorage({
  bucket,
  client: createS3CompatibleHttpClient({
    endpoint,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKeyId: requiredEnv('S3_ACCESS_KEY_ID')!,
    secretAccessKey: requiredEnv('S3_SECRET_ACCESS_KEY')!,
    sessionToken: process.env.S3_SESSION_TOKEN,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  }),
});

const checks: {
  id: string;
  ok: boolean;
  detail?: string | number;
  error?: string;
}[] = [];

async function check(id: string, task: () => Promise<string | number | undefined>) {
  try {
    checks.push({ id, ok: true, detail: await task() });
  } catch (error) {
    checks.push({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await check('put-object', async () => {
  const put = await storage.put({
    key,
    body: new TextEncoder().encode(bodyText),
    contentType: 'text/plain',
    metadata: { smoke: 'host-s3' },
  });
  return put.checksum;
});

await check('head-object', async () => {
  const head = await storage.head(key);
  if (!head) {
    throw new Error('S3_SMOKE_HEAD_NOT_FOUND');
  }
  if (head.metadata.smoke !== 'host-s3') {
    throw new Error('S3_SMOKE_METADATA_MISMATCH');
  }
  return head.sizeBytes;
});

await check('range-read', async () => {
  const object = await storage.get(key, { start: 0, end: 11 });
  const text = object ? new TextDecoder().decode(object.body) : '';
  if (!text.startsWith('ploykit-s3-')) {
    throw new Error(`S3_SMOKE_RANGE_MISMATCH: ${text}`);
  }
  return object?.sizeBytes ?? 0;
});

await check('presigned-url', async () => {
  const signedUrl = await storage.createSignedUrl({
    key,
    operation: 'read',
    expiresInSeconds: 60,
  });
  if (!signedUrl.includes('X-Amz-Signature=')) {
    throw new Error('S3_SMOKE_SIGNED_URL_MISSING_SIGNATURE');
  }
  if (checkSignedUrl) {
    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`S3_SMOKE_SIGNED_URL_FETCH_FAILED: ${response.status}`);
    }
  }
  return checkSignedUrl ? 'fetched' : 'created';
});

await check('delete-object', async () => {
  await storage.delete(key);
  const head = await storage.head(key);
  if (head) {
    throw new Error('S3_SMOKE_DELETE_STILL_EXISTS');
  }
  return 'deleted';
});

const result = {
  ok: checks.every((item) => item.ok),
  skipped: false,
  bucket,
  endpoint,
  key,
  checkedAt: new Date().toISOString(),
  checks,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
