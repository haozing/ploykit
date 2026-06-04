import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTestingModuleContext, createTestingServicesApi } from '@ploykit/module-sdk/testing';

function writeFixture(files: Record<string, string>) {
  const root = path.join('modules', `service-contract-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return root;
}

function runServiceContract(moduleRoot: string, openapiFile: string, extraArgs: string[] = []) {
  return childProcess.spawnSync(
    process.execPath,
    ['scripts/module-service-contract.mjs', moduleRoot, '--openapi', openapiFile, ...extraArgs],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    }
  );
}

test('module service contract CLI matches dynamic service client paths against OpenAPI YAML', (t) => {
  const fixtureRoot = writeFixture({
    'module.ts': `
      export default {
        id: 'service-contract-fixture',
        name: 'Service Contract Fixture',
        version: '0.1.0',
        serviceRequirements: {
          core: {
            required: true,
            provider: 'core',
            kind: 'signed-http',
            operations: { request: { input: { allow: ['path', 'method'] } } },
          },
        },
      };
    `,
    'lib/service-client.ts': `
      export function listJobs(ctx: { services: { invoke: Function } }, projectId: string) {
        return ctx.services.invoke('core', 'request', {
          path: \`/v1/projects/\${encodeURIComponent(projectId)}/jobs\`,
          method: 'GET',
        });
      }
    `,
    'openapi.yaml': `
openapi: 3.1.0
info:
  title: Core
  version: 1.0.0
paths:
  /v1/projects/{projectId}/jobs:
    get:
      responses:
        '200':
          description: OK
`,
  });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = runServiceContract(fixtureRoot, path.join(fixtureRoot, 'openapi.yaml'));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);

  assert.equal(report.success, true);
  assert.equal(report.moduleId, 'service-contract-fixture');
  assert.deepEqual(report.consumers.map((consumer: { method: string; path: string }) => `${consumer.method} ${consumer.path}`), [
    'GET /v1/projects/{param}/jobs',
  ]);
});

test('module service contract CLI fails when a consumed endpoint is missing', (t) => {
  const fixtureRoot = writeFixture({
    'module.ts': `
      export default { id: 'service-contract-missing', name: 'Missing', version: '0.1.0' };
    `,
    'tests/service-contract.json': JSON.stringify(
      {
        endpoints: [{ service: 'core', operation: 'request', method: 'POST', path: '/v1/jobs' }],
      },
      null,
      2
    ),
    'openapi.json': JSON.stringify(
      {
        openapi: '3.1.0',
        paths: {
          '/v1/projects': {
            get: {
              responses: { 200: { description: 'OK' } },
            },
          },
        },
      },
      null,
      2
    ),
  });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = runServiceContract(fixtureRoot, path.join(fixtureRoot, 'openapi.json'));
  assert.notEqual(result.status, 0, result.stdout);
  const report = JSON.parse(result.stdout);

  assert.equal(report.success, false);
  assert.equal(report.diagnostics[0].code, 'MODULE_SERVICE_CONTRACT_ENDPOINT_MISSING');
  assert.match(report.diagnostics[0].message, /POST \/v1\/jobs/);
});

test('module service contract CLI writes generated fixtures from OpenAPI examples', (t) => {
  const fixtureRoot = writeFixture({
    'module.ts': `
      export default { id: 'service-contract-fixtures', name: 'Fixtures', version: '0.1.0' };
    `,
    'tests/service-contract.json': JSON.stringify(
      {
        endpoints: [{ service: 'core', operation: 'request', method: 'GET', path: '/v1/status' }],
      },
      null,
      2
    ),
    'openapi.json': JSON.stringify(
      {
        openapi: '3.1.0',
        paths: {
          '/v1/status': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'application/json': {
                      example: { ready: true, mode: 'mock' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      null,
      2
    ),
  });
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = runServiceContract(fixtureRoot, path.join(fixtureRoot, 'openapi.json'), [
    '--write-fixtures',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  const fixtureFile = path.join(fixtureRoot, 'tests', 'fixtures', 'generated', 'get.v1.status.json');
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));

  assert.equal(report.mockFixtures[0].file.endsWith('get.v1.status.json'), true);
  assert.deepEqual(fixture.json, { ready: true, mode: 'mock' });
  assert.equal(fixture.generatedFrom.source, 'example');
});

test('testing module context supports fixture service handlers', async () => {
  const services = createTestingServicesApi({
    'core.request': async ({ request }) => ({
      ok: true,
      request,
      source: 'fixture',
    }),
  });
  const ctx = createTestingModuleContext({
    moduleId: 'service-fixture',
    services,
  });

  const result = await ctx.services.invoke<{ path: string }, { ok: boolean; source: string }>(
    'core',
    'request',
    { path: '/v1/status' }
  );

  assert.deepEqual(result, {
    ok: true,
    request: { path: '/v1/status' },
    source: 'fixture',
  });
});
