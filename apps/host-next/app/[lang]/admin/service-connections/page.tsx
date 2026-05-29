import { AdminServiceConnectionsOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminServiceConnections } from '@host/lib/admin-api';
import { createAdminAction } from '@host/lib/admin-action';
import {
  applyAdminServiceConnectionLogRetention,
  createAdminServiceConnection,
  rotateAdminServiceConnectionSecret,
  setAdminServiceConnectionStatus,
  testAdminServiceConnection,
  updateAdminServiceConnectionPolicy,
} from '@host/lib/admin-service-connections';
import { DEFAULT_HOST_WORKSPACE_ID } from '@host/lib/default-scope';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ADMIN_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value;
}

function readOptionalFormString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalFormNumber(formData: FormData, name: string): number | undefined {
  const value = readOptionalFormString(formData, name);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readOptionalJsonRecord(formData: FormData, name: string): Record<string, string> | undefined {
  const value = readOptionalFormString(formData, name);
  if (!value) {
    return undefined;
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`ADMIN_FORM_JSON_OBJECT_REQUIRED: ${name}`);
  }
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function readConnectionStatus(formData: FormData): 'active' | 'disabled' {
  const status = readRequiredFormString(formData, 'status');
  if (status !== 'active' && status !== 'disabled') {
    throw new Error(`ADMIN_CONNECTION_STATUS_UNSUPPORTED: ${status}`);
  }
  return status;
}

function readConnectionPolicyInput(formData: FormData) {
  return {
    connectionId: readRequiredFormString(formData, 'connectionId'),
    service: readOptionalFormString(formData, 'service'),
    provider: readOptionalFormString(formData, 'provider'),
    moduleId: readOptionalFormString(formData, 'moduleId'),
    workspaceId: readOptionalFormString(formData, 'workspaceId'),
    environment: readOptionalFormString(formData, 'environment'),
    ownerType: readOptionalFormString(formData, 'ownerType') as never,
    scopeType: readOptionalFormString(formData, 'scopeType') as never,
    authType: readOptionalFormString(formData, 'authType') as never,
    secretSource: readOptionalFormString(formData, 'secretSource'),
    secretRefs: readOptionalJsonRecord(formData, 'secretRefs'),
    baseUrl: readOptionalFormString(formData, 'baseUrl'),
    timeoutMs: readOptionalFormNumber(formData, 'timeoutMs'),
    retry: readOptionalFormString(formData, 'retry'),
    maxResponseBytes: readOptionalFormNumber(formData, 'maxResponseBytes'),
    healthCheck: readOptionalFormString(formData, 'healthCheck'),
    actorClaims: readOptionalFormString(formData, 'actorClaims'),
    reason: readOptionalFormString(formData, 'reason'),
  };
}

const testConnectionAction = createAdminAction({
  id: 'serviceConnections.test',
  parse: (formData) => ({
    connectionId: readRequiredFormString(formData, 'connectionId'),
    reason: formData.get('reason')?.toString(),
  }),
  run: ({ session, input }) =>
    testAdminServiceConnection(session, input.connectionId, input.reason),
  revalidate: () => ['/admin/service-connections'],
  audit: { metadata: ({ input, result }) => ({ ...input, result }) },
});

const updateConnectionStatusAction = createAdminAction({
  id: 'serviceConnections.updateStatus',
  parse: (formData) => ({
    connectionId: readRequiredFormString(formData, 'connectionId'),
    status: readConnectionStatus(formData),
    reason: formData.get('reason')?.toString(),
  }),
  run: ({ session, input }) =>
    setAdminServiceConnectionStatus(session, input.connectionId, input.status, input.reason),
  revalidate: () => ['/admin/service-connections'],
  audit: { metadata: ({ input }) => input },
});

const rotateConnectionSecretAction = createAdminAction({
  id: 'serviceConnections.rotateSecret',
  parse: (formData) => ({
    connectionId: readRequiredFormString(formData, 'connectionId'),
    secretSource: readRequiredFormString(formData, 'secretSource'),
    reason: formData.get('reason')?.toString(),
  }),
  run: ({ session, input }) =>
    rotateAdminServiceConnectionSecret(
      session,
      input.connectionId,
      input.secretSource,
      input.reason
    ),
  revalidate: () => ['/admin/service-connections'],
  audit: {
    metadata: ({ input }) => ({
      connectionId: input.connectionId,
      secretSource: input.secretSource,
      reason: input.reason,
    }),
  },
});

const createConnectionAction = createAdminAction({
  id: 'serviceConnections.create',
  parse: (formData) => ({
    ...readConnectionPolicyInput(formData),
    service: readRequiredFormString(formData, 'service'),
    provider: readRequiredFormString(formData, 'provider'),
    workspaceId: readOptionalFormString(formData, 'workspaceId') ?? DEFAULT_HOST_WORKSPACE_ID,
    baseUrl: readRequiredFormString(formData, 'baseUrl'),
  }),
  run: ({ session, input }) => createAdminServiceConnection(session, input),
  revalidate: () => ['/admin/service-connections'],
  audit: {
    metadata: ({ input }) => ({
      ...input,
      secretSource: input.secretSource ? '[set]' : undefined,
      secretRefs: input.secretRefs ? '[set]' : undefined,
    }),
  },
});

const updateConnectionPolicyAction = createAdminAction({
  id: 'serviceConnections.updatePolicy',
  parse: readConnectionPolicyInput,
  run: ({ session, input }) => updateAdminServiceConnectionPolicy(session, input),
  revalidate: () => ['/admin/service-connections'],
  audit: {
    metadata: ({ input }) => ({
      ...input,
      secretSource: input.secretSource ? '[set]' : undefined,
      secretRefs: input.secretRefs ? '[set]' : undefined,
    }),
  },
});

const applyLogRetentionAction = createAdminAction({
  id: 'serviceConnections.applyRetention',
  parse: (formData) => ({
    retentionDays: readOptionalFormNumber(formData, 'retentionDays'),
    reason: readOptionalFormString(formData, 'reason'),
  }),
  run: ({ session, input }) => applyAdminServiceConnectionLogRetention(session, input),
  revalidate: () => ['/admin/service-connections'],
  audit: { metadata: ({ input, result }) => ({ ...input, result }) },
});

export default async function AdminServiceConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/service-connections');
  const query = await readAdminTableQuery(searchParams);
  return (
    <AdminServiceConnectionsOperationsPage
      lang={lang}
      connections={await getAdminServiceConnections()}
      testConnectionAction={testConnectionAction}
      updateConnectionStatusAction={updateConnectionStatusAction}
      createConnectionAction={createConnectionAction}
      updateConnectionPolicyAction={updateConnectionPolicyAction}
      applyLogRetentionAction={applyLogRetentionAction}
      rotateConnectionSecretAction={rotateConnectionSecretAction}
      query={query}
    />
  );
}
