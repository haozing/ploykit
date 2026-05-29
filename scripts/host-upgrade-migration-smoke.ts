import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME_STORE_REQUIRED_TABLES } from '../src/lib/module-runtime/stores';

const required = process.argv.includes('--required');
const checkedAt = new Date().toISOString();
const migrationsDir = path.resolve(process.cwd(), 'migrations', 'runtime');
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'upgrade-migration',
  checkedAt.replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'upgrade-migration.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'upgrade-migration', 'latest.json');

interface MigrationFile {
  file: string;
  sequence?: number;
  sql: string;
  sqlWithoutComments: string;
  statements: string[];
  bytes: number;
}

interface MatrixCheck {
  id: string;
  ok: boolean;
  detail: unknown;
}

const DANGEROUS_PATTERNS = [
  { id: 'drop-table', pattern: /\bdrop\s+table\b/i },
  { id: 'drop-schema', pattern: /\bdrop\s+schema\b/i },
  { id: 'drop-column', pattern: /\bdrop\s+column\b/i },
  { id: 'truncate', pattern: /\btruncate\b/i },
  { id: 'delete-from', pattern: /\bdelete\s+from\b/i },
  { id: 'rename-table', pattern: /\brename\s+to\b/i },
];

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function readMigrations(): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      const sqlWithoutComments = stripSqlComments(sql);
      const match = file.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
      return {
        file,
        sequence: match ? Number(match[1]) : undefined,
        sql,
        sqlWithoutComments,
        statements: splitStatements(sqlWithoutComments),
        bytes: fs.statSync(filePath).size,
      };
    });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function check(id: string, ok: boolean, detail: unknown): MatrixCheck {
  return { id, ok, detail };
}

function extractCreateIndexName(statement: string): string | undefined {
  return statement.match(/^create\s+(?:unique\s+)?index\s+([a-z0-9_"]+)/i)?.[1]?.replace(/"/g, '');
}

function hasPriorDropIndex(migration: MigrationFile, statementIndex: number, indexName: string): boolean {
  const escaped = escapeRegex(indexName);
  const quoted = escapeRegex(`"${indexName}"`);
  const pattern = new RegExp(
    `^drop\\s+index\\s+if\\s+exists\\s+(?:${escaped}|${quoted})$`,
    'i'
  );
  return migration.statements
    .slice(0, statementIndex)
    .some((statement) => pattern.test(statement));
}

function findIdempotencyViolations(migrations: MigrationFile[]) {
  const violations: { file: string; statement: string; reason: string }[] = [];
  for (const migration of migrations) {
    for (const [statementIndex, statement] of migration.statements.entries()) {
      if (/^create\s+table\b/i.test(statement) && !/^create\s+table\s+if\s+not\s+exists\b/i.test(statement)) {
        violations.push({
          file: migration.file,
          statement,
          reason: 'create table must use if not exists',
        });
      }
      if (
        /^create\s+(unique\s+)?index\b/i.test(statement) &&
        !/^create\s+(unique\s+)?index\s+if\s+not\s+exists\b/i.test(statement)
      ) {
        const indexName = extractCreateIndexName(statement);
        if (indexName && hasPriorDropIndex(migration, statementIndex, indexName)) {
          continue;
        }
        violations.push({
          file: migration.file,
          statement,
          reason: 'create index must use if not exists',
        });
      }
      if (
        /^alter\s+table\b/i.test(statement) &&
        /\badd\s+column\b/i.test(statement) &&
        !/\badd\s+column\s+if\s+not\s+exists\b/i.test(statement)
      ) {
        violations.push({
          file: migration.file,
          statement,
          reason: 'add column must use if not exists',
        });
      }
    }
  }
  return violations;
}

function findDangerousStatements(migrations: MigrationFile[]) {
  const findings: { file: string; pattern: string; statement: string }[] = [];
  for (const migration of migrations) {
    for (const statement of migration.statements) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.id === 'delete-from' && isBoundedDedupeDelete(statement)) {
          continue;
        }
        if (pattern.pattern.test(statement)) {
          findings.push({ file: migration.file, pattern: pattern.id, statement });
        }
      }
    }
  }
  return findings;
}

function isBoundedDedupeDelete(statement: string): boolean {
  const normalized = statement.replace(/\s+/g, ' ');
  return (
    /^with\s+ranked_/i.test(normalized) &&
    /\brow_number\s*\(\s*\)\s+over\b/i.test(normalized) &&
    /\bdelete\s+from\b/i.test(normalized) &&
    /\b(?:ranked\.)?(?:row_number|duplicate_rank)\s*>\s*1\b/i.test(normalized)
  );
}

const migrations = readMigrations();
const filenameViolations = migrations.filter((migration) => migration.sequence === undefined);
const sequenceNumbers = migrations
  .map((migration) => migration.sequence)
  .filter((sequence): sequence is number => sequence !== undefined);
const duplicateSequences = sequenceNumbers.filter(
  (sequence, index) => sequenceNumbers.indexOf(sequence) !== index
);
const expectedSequences = Array.from({ length: migrations.length }, (_, index) => index + 1);
const sequenceOk =
  migrations.length > 0 &&
  duplicateSequences.length === 0 &&
  sequenceNumbers.length === migrations.length &&
  expectedSequences.every((sequence, index) => sequenceNumbers[index] === sequence);
const allSql = migrations.map((migration) => migration.sqlWithoutComments).join('\n');
const missingRequiredTables = RUNTIME_STORE_REQUIRED_TABLES.filter((table) => {
  const pattern = new RegExp(`\\bcreate\\s+table\\s+if\\s+not\\s+exists\\s+${escapeRegex(table)}\\b`, 'i');
  return !pattern.test(allSql);
});
const dangerousStatements = findDangerousStatements(migrations);
const idempotencyViolations = findIdempotencyViolations(migrations);
const checks = [
  check('runtime-migrations-present', migrations.length > 0, {
    migrations: migrations.length,
    migrationsDir,
  }),
  check('sequential-runtime-migrations', sequenceOk, {
    files: migrations.map((migration) => migration.file),
    expectedSequences,
    actualSequences: sequenceNumbers,
    duplicateSequences,
    filenameViolations: filenameViolations.map((migration) => migration.file),
  }),
  check('required-runtime-tables-covered', missingRequiredTables.length === 0, {
    requiredTables: RUNTIME_STORE_REQUIRED_TABLES.length,
    missingRequiredTables,
  }),
  check('non-destructive-runtime-migrations', dangerousStatements.length === 0, {
    findings: dangerousStatements,
  }),
  check('idempotent-runtime-migrations', idempotencyViolations.length === 0, {
    violations: idempotencyViolations,
  }),
];
const result = {
  ok: checks.every((item) => item.ok),
  required,
  checkedAt,
  mode: 'runtime-store-upgrade-migration-static',
  migrationsDir,
  migrations: migrations.map((migration) => ({
    file: migration.file,
    sequence: migration.sequence,
    statements: migration.statements.length,
    bytes: migration.bytes,
  })),
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
