/* eslint-disable no-console */

import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { getDockerDatabaseUrl, loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

type Status = 'passed' | 'failed' | 'skipped';

interface StepResult {
  name: string;
  status: Status;
  durationMs?: number;
  command?: string;
  detail?: string;
  error?: string;
}

interface BackupRestoreOptions {
  prepare: boolean;
  sourceDatabaseUrl: string;
  restoreDatabaseName: string;
}

interface Fixture {
  userId: string;
  auditId: string;
  fileId: string;
  filePath: string;
  fileSha256: string;
  pluginRecordId: string;
  outboxId: string;
}

interface BackupRestoreChecks {
  sourceCounts?: Counts;
  restoredCounts?: Counts;
  restoredFixture?: {
    fileExists: boolean;
    fileSha256Matches: boolean;
    pluginRecordRestored: boolean;
    auditRestored: boolean;
    outboxRestored: boolean;
  };
  backupFile?: string;
  backupSizeBytes?: number;
}

interface Counts {
  users: number;
  files: number;
  auditLogs: number;
  pluginRecords: number;
  eventOutbox: number;
  pluginInstallations: number;
}

interface BackupRestoreSummary {
  status: Status;
  startedAt: string;
  finishedAt?: string;
  databaseUrl: string;
  restoreDatabaseUrl: string;
  options: BackupRestoreOptions;
  steps: StepResult[];
  fixture?: Fixture;
  checks: BackupRestoreChecks;
  issues: string[];
  error?: string;
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'backup-restore-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '备份恢复矩阵测试报告.md');
const BACKUP_PATH = resolve(RESULT_DIR, 'ploykit-backup.dump');
const LOCAL_BLOB_ROOT = resolve(RESULT_DIR, 'source-blobs');
const RESTORED_BLOB_ROOT = resolve(RESULT_DIR, 'restored-blobs');

function parseOptions(): BackupRestoreOptions {
  const env = loadDockerDbEnv();
  const sourceDatabaseUrl = getDockerDatabaseUrl(env);
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
  return {
    prepare: !new Set(process.argv.slice(2)).has('--skip-prepare'),
    sourceDatabaseUrl,
    restoreDatabaseName: process.env.BACKUP_RESTORE_DB_NAME || `ploykit_restore_matrix_${suffix}`,
  };
}

function maskRestoreUrl(sourceUrl: string, databaseName: string): string {
  return maskDatabaseUrl(setDatabaseName(sourceUrl, databaseName));
}

function setDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function getMaintenanceDatabaseUrl(databaseUrl: string): string {
  return setDatabaseName(databaseUrl, 'postgres');
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function commandFor(name: string, args: string[]) {
  return {
    file: process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name,
    args,
    display: [name, ...args].join(' '),
  };
}

async function runCommand(name: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const command = commandFor(name, args);
  console.log(`Running ${command.display}`);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command.display} exited with code ${code}`));
    });
  });
}

async function runStep(
  summary: BackupRestoreSummary,
  name: string,
  fn: () => Promise<string | undefined>
): Promise<void> {
  const started = Date.now();
  const step: StepResult = { name, status: 'failed' };
  summary.steps.push(step);
  console.log(`Running ${name}`);
  try {
    const detail = await fn();
    step.status = 'passed';
    step.durationMs = Date.now() - started;
    step.detail = detail;
  } catch (error) {
    step.status = 'failed';
    step.durationMs = Date.now() - started;
    step.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  }
}

function resetResultDir(): void {
  const expected = resolve(process.cwd(), 'test-results', 'backup-restore-matrix');
  if (RESULT_DIR !== expected) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }
  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
  mkdirSync(LOCAL_BLOB_ROOT, { recursive: true });
  mkdirSync(RESTORED_BLOB_ROOT, { recursive: true });
}

async function recreateDatabase(databaseUrl: string, databaseName: string): Promise<void> {
  const admin = postgres(getMaintenanceDatabaseUrl(databaseUrl), { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${quoteIdent(databaseName)}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function seedFixture(databaseUrl: string): Promise<Fixture> {
  const sql = postgres(databaseUrl, { max: 1 });
  const fixtureId = randomUUID();
  const userId = `backup-user-${fixtureId}`;
  const fileId = `backup-file-${fixtureId}`;
  const pluginRecordId = `backup-record-${fixtureId}`;
  const outboxId = `backup-outbox-${fixtureId}`;
  const auditId = randomUUID();
  const fileBody = Buffer.from(`backup restore fixture ${fixtureId}`, 'utf8');
  const fileName = `${fileId}.txt`;
  const filePath = `backup-matrix/${fileName}`;
  const blobPath = join(LOCAL_BLOB_ROOT, filePath);

  mkdirSync(join(LOCAL_BLOB_ROOT, 'backup-matrix'), { recursive: true });
  await writeFile(blobPath, fileBody);

  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into "user" (id, email, "emailVerified", name, "createdAt", "updatedAt")
        values (
          ${userId},
          ${`backup-${fixtureId}@example.test`},
          true,
          'Backup Matrix User',
          now(),
          now()
        )
        on conflict (id) do nothing
      `;
      await tx`
        insert into files (
          id, user_id, file_name, original_name, mime_type, size, uploaded_by,
          uploaded_by_email, path, folder, provider, created_at, updated_at
        )
        values (
          ${fileId},
          ${userId},
          ${fileName},
          ${fileName},
          'text/plain',
          ${fileBody.length},
          ${userId},
          ${`backup-${fixtureId}@example.test`},
          ${filePath},
          'backup-matrix',
          'local',
          now(),
          now()
        )
      `;
      await tx`
        insert into plugin_records (id, plugin_id, collection_name, user_id, data, created_at, updated_at)
        values (
          ${pluginRecordId},
          'sample-internal',
          'sample_internal_notes',
          ${userId},
          ${sql.json({ title: 'Backup matrix note', status: 'open', fixtureId })},
          now(),
          now()
        )
      `;
      await tx`
        insert into event_outbox (id, event, payload, metadata, status, attempts, max_attempts)
        values (
          ${outboxId},
          'backup.matrix.fixture',
          ${sql.json({ fixtureId })},
          ${sql.json({ source: 'backup-restore-matrix' })},
          'completed',
          1,
          3
        )
      `;
      await tx`
        insert into audit_logs (
          id, user_id, user_email, action, resource, resource_id, status, metadata, created_at
        )
        values (
          ${auditId},
          ${userId},
          ${`backup-${fixtureId}@example.test`},
          'backup.matrix.fixture',
          'backup_restore',
          ${fixtureId},
          'success',
          ${sql.json({ fixtureId })},
          now()
        )
      `;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  return {
    userId,
    auditId,
    fileId,
    filePath,
    fileSha256: createHash('sha256').update(fileBody).digest('hex'),
    pluginRecordId,
    outboxId,
  };
}

async function readCounts(databaseUrl: string): Promise<Counts> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [row] = await sql<Counts[]>`
      select
        (select count(*)::int from "user") as users,
        (select count(*)::int from files) as files,
        (select count(*)::int from audit_logs) as "auditLogs",
        (select count(*)::int from plugin_records) as "pluginRecords",
        (select count(*)::int from event_outbox) as "eventOutbox",
        (select count(*)::int from plugin_installations) as "pluginInstallations"
    `;
    return {
      users: Number(row?.users ?? 0),
      files: Number(row?.files ?? 0),
      auditLogs: Number(row?.auditLogs ?? 0),
      pluginRecords: Number(row?.pluginRecords ?? 0),
      eventOutbox: Number(row?.eventOutbox ?? 0),
      pluginInstallations: Number(row?.pluginInstallations ?? 0),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function buildPgEnv(
  databaseUrl: string,
  extra: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    ...extra,
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

function pgConnection(databaseUrl: string): {
  host: string;
  port: string;
  user: string;
  database: string;
} {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    database: basename(url.pathname),
  };
}

async function commandExists(name: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where.exe' : 'command';
  const args = process.platform === 'win32' ? [name] : ['-v', name];
  return await new Promise((resolvePromise) => {
    const child = spawn(probe, args, {
      cwd: process.cwd(),
      stdio: 'ignore',
      shell: process.platform !== 'win32',
    });
    child.on('error', () => resolvePromise(false));
    child.on('exit', (code) => resolvePromise(code === 0));
  });
}

async function runPgDump(databaseUrl: string, outputPath: string): Promise<void> {
  const connection = pgConnection(databaseUrl);
  if (await commandExists('pg_dump')) {
    const env = buildPgEnv(databaseUrl);
    const args = [
      '-h',
      connection.host,
      '-p',
      connection.port,
      '-U',
      connection.user,
      '-d',
      connection.database,
      '-Fc',
      '-f',
      outputPath,
    ];
    const command = commandFor('pg_dump', args);
    console.log(`Running ${command.display}`);
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command.file, command.args, {
        cwd: process.cwd(),
        env,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`${command.display} exited with code ${code}`));
      });
    });
    return;
  }

  const args = [
    'compose',
    'exec',
    '-T',
    'db',
    'pg_dump',
    '-U',
    connection.user,
    '-d',
    connection.database,
    '-Fc',
  ];
  const command = commandFor('docker', args);
  console.log(`Running ${command.display} > ${outputPath}`);
  await new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(outputPath);
    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.pipe(output);
    child.on('error', reject);
    child.on('exit', (code) => {
      output.end();
      if (code === 0) resolvePromise();
      else reject(new Error(`${command.display} exited with code ${code}`));
    });
  });
}

async function runPgRestore(databaseUrl: string, inputPath: string): Promise<void> {
  await access(inputPath);
  const connection = pgConnection(databaseUrl);
  if (await commandExists('pg_restore')) {
    const env = buildPgEnv(databaseUrl);
    const args = [
      '-h',
      connection.host,
      '-p',
      connection.port,
      '-U',
      connection.user,
      '-d',
      connection.database,
      '--clean',
      '--if-exists',
      '--no-owner',
      inputPath,
    ];
    const command = commandFor('pg_restore', args);
    console.log(`Running ${command.display}`);
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command.file, command.args, {
        cwd: process.cwd(),
        env,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`${command.display} exited with code ${code}`));
      });
    });
    return;
  }

  const args = [
    'compose',
    'exec',
    '-T',
    'db',
    'pg_restore',
    '-U',
    connection.user,
    '-d',
    connection.database,
    '--clean',
    '--if-exists',
    '--no-owner',
  ];
  const command = commandFor('docker', args);
  console.log(`Running ${command.display} < ${inputPath}`);
  await new Promise<void>((resolvePromise, reject) => {
    const input = createReadStream(inputPath);
    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    input.pipe(child.stdin);
    input.on('error', reject);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command.display} exited with code ${code}`));
    });
  });
}

async function verifyRestoredFixture(databaseUrl: string, fixture: Fixture) {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [row] = await sql<
      Array<{
        filePath: string | null;
        pluginRecordId: string | null;
        auditId: string | null;
        outboxId: string | null;
      }>
    >`
      select
        (select path from files where id = ${fixture.fileId}) as "filePath",
        (select id from plugin_records where id = ${fixture.pluginRecordId}) as "pluginRecordId",
        (select id::text from audit_logs where id = ${fixture.auditId}) as "auditId",
        (select id from event_outbox where id = ${fixture.outboxId}) as "outboxId"
    `;
    const restoredBlobPath = join(RESTORED_BLOB_ROOT, row?.filePath ?? '');
    const fileExists = existsSync(restoredBlobPath);
    const restoredSha256 = fileExists
      ? createHash('sha256')
          .update(await readFile(restoredBlobPath))
          .digest('hex')
      : null;
    return {
      fileExists,
      fileSha256Matches: restoredSha256 === fixture.fileSha256,
      pluginRecordRestored: row?.pluginRecordId === fixture.pluginRecordId,
      auditRestored: row?.auditId === fixture.auditId,
      outboxRestored: row?.outboxId === fixture.outboxId,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const restoreDatabaseUrl = setDatabaseName(
    options.sourceDatabaseUrl,
    options.restoreDatabaseName
  );
  const summary: BackupRestoreSummary = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    databaseUrl: maskDatabaseUrl(options.sourceDatabaseUrl),
    restoreDatabaseUrl: maskRestoreUrl(options.sourceDatabaseUrl, options.restoreDatabaseName),
    options,
    steps: [],
    checks: {},
    issues: [],
  };

  resetResultDir();

  try {
    if (options.prepare) {
      await runStep(summary, 'docker db up', async () => {
        await runCommand('docker', ['compose', 'up', '-d', 'db'], process.env);
        return 'db service requested';
      });
      await runStep(summary, 'docker db wait', async () => {
        await runCommand('npm', ['run', 'db:docker:wait'], process.env);
        return 'db ready';
      });
    } else {
      summary.steps.push({ name: 'prepare database', status: 'skipped' });
    }

    await runStep(summary, 'seed source fixture', async () => {
      summary.fixture = await seedFixture(options.sourceDatabaseUrl);
      return summary.fixture.fileId;
    });
    await runStep(summary, 'read source counts', async () => {
      summary.checks.sourceCounts = await readCounts(options.sourceDatabaseUrl);
      return JSON.stringify(summary.checks.sourceCounts);
    });
    await runStep(summary, 'pg_dump source database', async () => {
      await runPgDump(options.sourceDatabaseUrl, BACKUP_PATH);
      summary.checks.backupFile = BACKUP_PATH;
      summary.checks.backupSizeBytes = (await readFile(BACKUP_PATH)).byteLength;
      return `${summary.checks.backupSizeBytes} bytes`;
    });
    await runStep(summary, 'copy local blob backup', async () => {
      const fixture = summary.fixture!;
      const sourcePath = join(LOCAL_BLOB_ROOT, fixture.filePath);
      const targetPath = join(RESTORED_BLOB_ROOT, fixture.filePath);
      mkdirSync(resolve(targetPath, '..'), { recursive: true });
      await writeFile(targetPath, await readFile(sourcePath));
      return fixture.filePath;
    });
    await runStep(summary, 'create isolated restore database', async () => {
      await recreateDatabase(options.sourceDatabaseUrl, options.restoreDatabaseName);
      return options.restoreDatabaseName;
    });
    await runStep(summary, 'pg_restore into isolated database', async () => {
      await runPgRestore(restoreDatabaseUrl, BACKUP_PATH);
      return options.restoreDatabaseName;
    });
    await runStep(summary, 'verify restored data and blobs', async () => {
      summary.checks.restoredCounts = await readCounts(restoreDatabaseUrl);
      summary.checks.restoredFixture = await verifyRestoredFixture(
        restoreDatabaseUrl,
        summary.fixture!
      );
      return JSON.stringify(summary.checks.restoredFixture);
    });

    const sourceCounts = summary.checks.sourceCounts;
    const restoredCounts = summary.checks.restoredCounts;
    if (!sourceCounts || !restoredCounts) {
      summary.issues.push('Source or restored counts are missing');
    } else {
      for (const key of Object.keys(sourceCounts) as Array<keyof Counts>) {
        if (restoredCounts[key] !== sourceCounts[key]) {
          summary.issues.push(
            `Restored count for ${key} (${restoredCounts[key]}) differs from source (${sourceCounts[key]})`
          );
        }
      }
    }

    const fixture = summary.checks.restoredFixture;
    if (!fixture || Object.values(fixture).some((value) => value !== true)) {
      summary.issues.push(`Restored fixture check failed: ${JSON.stringify(fixture)}`);
    }

    summary.status = summary.issues.length === 0 ? 'passed' : 'failed';
    if (summary.status !== 'passed') {
      process.exitCode = 1;
    }
  } catch (error) {
    summary.status = 'failed';
    summary.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    writeFileSync(REPORT_PATH, createReport(summary), 'utf8');
  }
}

function createReport(summary: BackupRestoreSummary): string {
  const stepRows = summary.steps
    .map(
      (step) =>
        `| ${step.name} | ${step.status} | ${step.durationMs ?? '-'} | ${step.detail ?? step.command ?? '-'} |`
    )
    .join('\n');

  return `# 备份恢复矩阵测试报告

更新时间：${new Date().toISOString()}

## 结论

- 状态：${summary.status}
- 源数据库：${summary.databaseUrl}
- 恢复数据库：${summary.restoreDatabaseUrl}
- 备份文件：${summary.checks.backupFile ?? '-'}
- 备份大小：${summary.checks.backupSizeBytes ?? '-'} bytes

## 验收边界

本报告用于 P2-03 备份恢复验收。测试会向源库写入一组 fixture，执行 \`pg_dump -Fc\`，创建隔离恢复库并 \`pg_restore\`，再校验关键表计数、插件记录、审计、outbox 以及本地对象存储 blob 的备份恢复一致性。

## 关键计数

- 源库：${JSON.stringify(summary.checks.sourceCounts ?? {})}
- 恢复库：${JSON.stringify(summary.checks.restoredCounts ?? {})}

## Fixture

- 文件恢复：${summary.checks.restoredFixture?.fileExists ? 'yes' : 'no'}
- 文件 sha256 一致：${summary.checks.restoredFixture?.fileSha256Matches ? 'yes' : 'no'}
- 插件记录恢复：${summary.checks.restoredFixture?.pluginRecordRestored ? 'yes' : 'no'}
- 审计恢复：${summary.checks.restoredFixture?.auditRestored ? 'yes' : 'no'}
- Outbox 恢复：${summary.checks.restoredFixture?.outboxRestored ? 'yes' : 'no'}

## 步骤

| 步骤 | 状态 | 耗时 ms | 详情 |
| ---- | ---- | ------- | ---- |
${stepRows}

## 问题

${summary.issues.map((issue) => `- ${issue}`).join('\n') || '- 无'}

## 结果文件

- \`test-results/backup-restore-matrix/summary.json\`
- \`test-results/backup-restore-matrix/ploykit-backup.dump\`
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
