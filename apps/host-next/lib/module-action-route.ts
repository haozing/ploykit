interface ModuleActionRouteContext {
  params: Promise<{
    moduleId: string;
    name: string;
  }>;
}

export interface ModuleActionExecuteInput {
  moduleId: string;
  name: string;
  input: unknown;
  request: Request;
  confirmed?: boolean;
  idempotencyKey?: string;
}

interface ModuleActionHost {
  executeAction(input: ModuleActionExecuteInput): Promise<unknown>;
}

export interface ModuleActionRouteDependencies {
  getModuleHost(): Promise<ModuleActionHost>;
  checkHostRouteSecurity(request: Request, routeId: 'module.action'): Promise<Response | null>;
}

interface ActionPayload {
  input: unknown;
  confirmed?: boolean;
  idempotencyKey?: string;
  redirectTo?: string;
  redirectOnComplete: boolean;
}

class ModuleActionPayloadError extends Error {
  constructor(message: string) {
    super(`MODULE_ACTION_PAYLOAD_INVALID: ${message}`);
  }
}

function isFormContentType(contentType: string): boolean {
  return (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  );
}

function defaultActionPayload(request: Request): ActionPayload {
  return {
    input: undefined,
    redirectOnComplete: isFormContentType(request.headers.get('content-type') ?? ''),
  };
}

function readFormString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readFormSet(formData: FormData, key: string): Set<string> {
  return new Set(
    (readFormString(formData, key) ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function parseJson(text: string, description: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ModuleActionPayloadError(`Invalid JSON in ${description}.`);
  }
}

function parseFormValue(
  key: string,
  value: FormDataEntryValue,
  fields: {
    json: Set<string>;
    numbers: Set<string>;
    arrays: Set<string>;
    booleans: Set<string>;
  }
): unknown {
  const text = typeof value === 'string' ? value.trim() : '';
  if (fields.booleans.has(key)) {
    return text === '1' || text === 'on' || text.toLowerCase() === 'true';
  }
  if (!text) {
    return undefined;
  }
  if (fields.json.has(key)) {
    return parseJson(text, `form field "${key}"`);
  }
  if (fields.numbers.has(key)) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (fields.arrays.has(key)) {
    if (text.startsWith('[')) {
      const parsed = parseJson(text, `form field "${key}"`);
      return Array.isArray(parsed) ? parsed : undefined;
    }
    return text
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return text;
}

async function readJsonActionPayload(request: Request): Promise<ActionPayload> {
  try {
    return {
      input: await request.json(),
      redirectOnComplete: false,
    };
  } catch {
    throw new ModuleActionPayloadError('Invalid JSON request body.');
  }
}

async function readFormActionPayload(request: Request): Promise<ActionPayload> {
  const formData = await request.formData();
  const fields = {
    json: readFormSet(formData, '_jsonFields'),
    numbers: readFormSet(formData, '_numberFields'),
    arrays: readFormSet(formData, '_arrayFields'),
    booleans: readFormSet(formData, '_booleanFields'),
  };
  const input: Record<string, unknown> = {};

  for (const key of fields.booleans) {
    input[key] = false;
  }

  for (const [key, value] of formData.entries()) {
    if (key.startsWith('_')) {
      continue;
    }
    const parsed = parseFormValue(key, value, fields);
    if (parsed !== undefined) {
      input[key] = parsed;
    }
  }

  return {
    input,
    confirmed: readFormConfirmed(formData),
    idempotencyKey: readFormString(formData, '_idempotencyKey') ?? crypto.randomUUID(),
    redirectTo: readFormString(formData, '_next'),
    redirectOnComplete: true,
  };
}

async function readActionPayload(request: Request): Promise<ActionPayload> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return readJsonActionPayload(request);
  }

  if (isFormContentType(contentType)) {
    return readFormActionPayload(request);
  }

  return {
    input: undefined,
    redirectOnComplete: false,
  };
}

function readActionConfirmed(request: Request): boolean {
  const value =
    request.headers.get('x-ploykit-action-confirmed') ?? request.headers.get('x-action-confirmed');
  return value === '1' || value?.toLowerCase() === 'true';
}

function readFormConfirmed(formData: FormData): boolean {
  const value = readFormString(formData, '_confirmed');
  return value === '1' || value === 'on' || value?.toLowerCase() === 'true';
}

function readIdempotencyKey(request: Request): string | undefined {
  return (
    request.headers.get('idempotency-key')?.trim() ||
    request.headers.get('x-idempotency-key')?.trim() ||
    request.headers.get('x-ploykit-idempotency-key')?.trim() ||
    undefined
  );
}

function safeRedirectTarget(
  request: Request,
  target: string | undefined,
  status: string,
  code?: string
) {
  const fallback = request.headers.get('referer') ?? '/dashboard';
  const url = new URL(target ?? fallback, request.url);
  const origin = new URL(request.url).origin;
  if (url.origin !== origin) {
    return new URL('/dashboard', request.url);
  }
  url.searchParams.set('moduleAction', status);
  if (code) {
    url.searchParams.set('moduleActionCode', code);
  } else {
    url.searchParams.delete('moduleActionCode');
  }
  return url;
}

function actionErrorStatus(code: string): number {
  if (code.endsWith('NOT_FOUND')) {
    return 404;
  }
  if (code.endsWith('AUTH_REQUIRED')) {
    return 401;
  }
  if (
    code.includes('ADMIN_REQUIRED') ||
    code.includes('PERMISSION') ||
    code.includes('ENTITLEMENT') ||
    code.includes('PLAN_REQUIRED') ||
    code.includes('CREDITS_REQUIRED')
  ) {
    return 403;
  }
  if (
    code.includes('CONFIRMATION_REQUIRED') ||
    code.includes('IDEMPOTENCY_KEY_REQUIRED') ||
    code.includes('PAYLOAD_INVALID')
  ) {
    return 400;
  }
  if (code.includes('TIMEOUT')) {
    return 504;
  }
  return 500;
}

function actionErrorDetails(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : 'Module action failed.';
  const code = message.match(/^(MODULE_ACTION_[A-Z0-9_]+)/)?.[1] ?? 'MODULE_ACTION_ROUTE_ERROR';
  return { code, message };
}

function actionErrorResponse(error: unknown): Response {
  const { code, message } = actionErrorDetails(error);
  return Response.json(
    {
      ok: false,
      code,
      message,
    },
    { status: actionErrorStatus(code) }
  );
}

export async function handleModuleActionPost(
  request: Request,
  context: ModuleActionRouteContext,
  dependencies: ModuleActionRouteDependencies
) {
  const securityResponse = await dependencies.checkHostRouteSecurity(request, 'module.action');
  if (securityResponse) {
    return securityResponse;
  }

  const host = await dependencies.getModuleHost();
  const { moduleId, name } = await context.params;
  let payload = defaultActionPayload(request);

  try {
    payload = await readActionPayload(request);
    const result = await host.executeAction({
      moduleId,
      name,
      input: payload.input,
      request,
      confirmed: payload.confirmed ?? readActionConfirmed(request),
      idempotencyKey: payload.idempotencyKey ?? readIdempotencyKey(request),
    });

    if (payload.redirectOnComplete) {
      return Response.redirect(safeRedirectTarget(request, payload.redirectTo, 'ok'), 303);
    }

    return Response.json({ ok: true, result });
  } catch (error) {
    if (payload.redirectOnComplete) {
      const { code } = actionErrorDetails(error);
      return Response.redirect(safeRedirectTarget(request, payload.redirectTo, 'error', code), 303);
    }
    return actionErrorResponse(error);
  }
}
