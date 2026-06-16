import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const skipDocker = process.argv.includes('--no-docker');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.status}${stderr ? `: ${stderr}` : ''}`
    );
  }
  return result;
}

function tryRun(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env ?? process.env,
  });
}

function ensureMinioContainer() {
  const compose = tryRun(docker, ['compose', 'up', '-d', 'minio'], { capture: true });
  if (compose.status === 0) {
    run(docker, ['compose', 'run', '--rm', 'minio-init']);
    return;
  }

  const output = `${compose.stdout ?? ''}\n${compose.stderr ?? ''}`;
  if (!output.includes('container name "/ploykit-v2-minio" is already in use')) {
    const stderr = compose.stderr?.trim();
    throw new Error(
      `${docker} compose up -d minio failed with ${compose.status}${stderr ? `: ${stderr}` : ''}`
    );
  }

  run(docker, ['start', 'ploykit-v2-minio']);
}

try {
  if (!skipDocker) {
    ensureMinioContainer();
  }

  const smoke = run(
    npm,
    ['run', 'host:s3-smoke', '--', '--required', '--check-signed-url'],
    {
      capture: true,
      env: {
        ...process.env,
        S3_BUCKET: process.env.S3_BUCKET ?? 'ploykit-files',
        S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://localhost:59000',
        S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT ?? 'http://localhost:59000',
        S3_REGION: process.env.S3_REGION ?? 'us-east-1',
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'ploykit',
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'ploykit-minio-secret',
        S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? 'true',
      },
    }
  );
  const detail = JSON.parse(smoke.stdout.slice(smoke.stdout.indexOf('{')));
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: Boolean(detail.ok),
        profile: 'local-minio',
        checkedAt: new Date().toISOString(),
        endpoint: detail.endpoint,
        bucket: detail.bucket,
        key: detail.key,
        checks: detail.checks,
      },
      null,
      2
    )}\n`
  );
  process.exitCode = detail.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
