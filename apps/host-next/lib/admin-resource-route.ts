import type { ModuleHost } from '@/lib/module-runtime';
import { toPublicAdminResourceEntry } from '@/lib/module-runtime';
import { apiError, apiOk, readJsonObject, requireApiSession } from './api';

export interface AdminResourceRouteContext {
  params: Promise<{
    resourceId: string;
    operationName: string;
  }>;
}

export interface AdminResourceRouteDependencies {
  getModuleHost(): Promise<Pick<ModuleHost, 'executeAdminResourceOperation' | 'runtime'>>;
  requireApiSession?: typeof requireApiSession;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorStatus(message: string): number {
  if (
    message.startsWith('ADMIN_RESOURCE_NOT_FOUND') ||
    message.startsWith('ADMIN_RESOURCE_OPERATION_NOT_FOUND')
  ) {
    return 404;
  }
  if (
    message.startsWith('ADMIN_RESOURCE_OPERATION_FORBIDDEN') ||
    message.startsWith('ADMIN_RESOURCE_OPERATION_PERMISSION_DENIED')
  ) {
    return 403;
  }
  if (message.startsWith('ADMIN_RESOURCE_OPERATION_CONFIRMATION_REQUIRED')) {
    return 409;
  }
  return 500;
}

export async function handleAdminResourceOperationPost(
  request: Request,
  context: AdminResourceRouteContext,
  dependencies: AdminResourceRouteDependencies
): Promise<Response> {
  const resolved = await (dependencies.requireApiSession ?? requireApiSession)(
    request,
    'admin.resources.execute',
    { admin: true }
  );
  if (resolved instanceof Response) {
    return resolved;
  }

  const { resourceId, operationName } = await context.params;
  const body = await readJsonObject(request);

  try {
    const result = await (
      await dependencies.getModuleHost()
    ).executeAdminResourceOperation({
      resourceId,
      operationName,
      request,
      session: resolved.session,
      input: body.input,
      confirmation: readRecord(body.confirmation),
    });

    return apiOk({ result: result ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return apiError(
      errorStatus(message),
      message.split(':')[0] || 'ADMIN_RESOURCE_OPERATION_FAILED',
      message
    );
  }
}

export async function handleAdminResourcesGet(
  request: Request,
  dependencies: AdminResourceRouteDependencies
): Promise<Response> {
  const resolved = await (dependencies.requireApiSession ?? requireApiSession)(
    request,
    'admin.resources.read',
    { admin: true }
  );
  if (resolved instanceof Response) {
    return resolved;
  }

  const resources = (await dependencies.getModuleHost()).runtime.adminResources
    .list()
    .map(toPublicAdminResourceEntry);
  return apiOk({ resources });
}
