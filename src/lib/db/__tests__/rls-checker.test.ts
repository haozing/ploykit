import { describe, expect, it } from 'vitest';
import { DEFAULT_RLS_REQUIREMENTS, type RLSStatus, validateRLSStatuses } from '../rls-checker';

function createStatus(
  table: string,
  overrides?: Partial<RLSStatus>,
  isolationColumns: string[] = ['user_id']
): RLSStatus {
  const isolationExpression = isolationColumns
    .map((column) => {
      const functionName =
        column === 'plugin_id' ? 'current_app_plugin_id()' : 'current_app_user_id()';
      return `${column} = ${functionName}`;
    })
    .join(' AND ');
  const policyExpression = isolationExpression
    ? `((${isolationExpression}) OR (current_app_user_id() = 'system'))`
    : `(current_app_user_id() = 'system')`;

  return {
    table,
    rlsEnabled: true,
    rlsForced: true,
    policies: [
      {
        name: `${table}_user_isolation`,
        command: 'ALL',
        qual: policyExpression,
        withCheck: policyExpression,
      },
    ],
    ...overrides,
  };
}

describe('RLS checker', () => {
  it('passes when required tables have forced RLS and user isolation policies', () => {
    const statuses = DEFAULT_RLS_REQUIREMENTS.map((requirement) =>
      createStatus(requirement.table, undefined, requirement.isolationColumns)
    );

    const result = validateRLSStatuses(statuses, DEFAULT_RLS_REQUIREMENTS);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary.rlsForcedTables).toBe(DEFAULT_RLS_REQUIREMENTS.length);
  });

  it('fails when a required table is missing', () => {
    const result = validateRLSStatuses([], ['files']);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Table "files" not found in database');
  });

  it('fails when RLS is enabled but not forced', () => {
    const result = validateRLSStatuses([createStatus('files', { rlsForced: false })], ['files']);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('RLS not forced on table "files"');
  });

  it('fails when policies do not reference user_id', () => {
    const result = validateRLSStatuses(
      [
        createStatus('files', {
          policies: [
            {
              name: 'files_public_policy',
              command: 'ALL',
              qual: 'true',
            },
          ],
        }),
      ],
      ['files']
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Table "files" has no RLS policy referencing user_id');
  });

  it('validates dynamic plugin model table requirements', () => {
    const result = validateRLSStatuses(
      [createStatus('plugin_export_export_history')],
      [{ table: 'plugin_export_export_history', isolationColumns: ['user_id'], requireForce: true }]
    );

    expect(result.valid).toBe(true);
  });

  it('accepts system-only host secret policies', () => {
    const result = validateRLSStatuses(
      [createStatus('host_secrets', undefined, [])],
      [{ table: 'host_secrets', isolationColumns: [], requireForce: true }]
    );

    expect(result.valid).toBe(true);
  });
});
