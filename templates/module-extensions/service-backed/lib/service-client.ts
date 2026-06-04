import type { ModuleContext } from '@ploykit/module-sdk';
import { toServiceErrorEnvelope } from './service-errors';

export type ServiceHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ServiceCoreRequest {
  path: string;
  method?: ServiceHttpMethod;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  tenantId?: string;
}

export interface ServiceCoreResult<TJson = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  url?: string;
  headers?: Record<string, string>;
  json?: TJson;
  body?: string;
  attempts?: number;
}

export async function invokeServiceCore<TJson = unknown>(
  ctx: ModuleContext,
  request: ServiceCoreRequest
): Promise<ServiceCoreResult<TJson>> {
  try {
    return await ctx.services.invoke<ServiceCoreRequest, ServiceCoreResult<TJson>>(
      'serviceCore',
      'request',
      request,
      { correlationId: ctx.request.correlationId }
    );
  } catch (error) {
    return toServiceErrorEnvelope<TJson>(error);
  }
}
