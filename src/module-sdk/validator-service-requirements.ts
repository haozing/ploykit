import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import type {
  ModuleDefinition,
  ModuleHttpMethod,
  ModuleServiceOperationDefinition,
} from './types';

const SERVICE_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;
const SERVICE_OPERATION_PATTERN = /^[a-z][a-zA-Z0-9_.:-]*$/;
const ORIGIN_PATTERN = /^https?:\/\/[^/\s]+$/;
const HTTP_METHODS = new Set<ModuleHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SERVICE_CONNECTION_KINDS = new Set(['signed-http']);
const SERVICE_RETRY_BACKOFFS = new Set(['none', 'linear', 'exponential']);
const SERVICE_REQUEST_BODIES = new Set(['none', 'json', 'text']);
const SERVICE_RESPONSE_BODIES = new Set(['json', 'text', 'raw']);
const SERVICE_AUTH_TYPES = new Set(['none', 'bearer']);
const SERVICE_SIGNING_TYPES = new Set(['none', 'hmac-sha256']);
const SERVICE_INPUT_FIELDS = new Set(['url', 'path', 'method', 'headers', 'query', 'body', 'json']);
const SERVICE_SIGNING_CANONICAL_FIELDS = new Set([
  'method',
  'path',
  'timestamp',
  'bodySha256',
  'claimsSha256',
]);
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MANAGED_SERVICE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-service-signature',
  'x-service-timestamp',
  'x-service-claims',
]);

type ServiceRequirement = NonNullable<ModuleDefinition['serviceRequirements']>[string];

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'error', message, path, fix }));
}

function operationManagedServiceHeaders(operation: ModuleServiceOperationDefinition): Set<string> {
  const headers = new Set(MANAGED_SERVICE_HEADERS);
  if (operation.auth?.type === 'bearer') {
    headers.add((operation.auth.header ?? 'authorization').toLowerCase());
  }
  if (operation.signing?.type === 'hmac-sha256') {
    headers.add((operation.signing.header ?? 'x-service-signature').toLowerCase());
    headers.add((operation.signing.timestampHeader ?? 'x-service-timestamp').toLowerCase());
    headers.add((operation.signing.claimsHeader ?? 'x-service-claims').toLowerCase());
  }
  return headers;
}

function serviceRequirementUsesOperationPolicy(requirement: ServiceRequirement): boolean {
  return Boolean(
    requirement.kind ||
      requirement.connection ||
      requirement.secrets ||
      requirement.claims ||
      requirement.operations
  );
}

function isAllowedServiceClaimExpression(expression: string): boolean {
  return (
    /^ctx\.module\.(id|version)$/.test(expression) ||
    /^ctx\.scope\.(productId|workspaceId|userId|actorId)$/.test(expression) ||
    /^ctx\.auth\.(actorId|isAuthenticated)$/.test(expression) ||
    /^ctx\.request\.(id|method|path|correlationId)$/.test(expression) ||
    /^resource\.[a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z][a-zA-Z0-9_]*$/.test(expression) ||
    /^input\.[a-zA-Z][a-zA-Z0-9_]*$/.test(expression)
  );
}

function validateServiceClaimsTemplate(
  diagnostics: ModuleDiagnostic[],
  template: string,
  path: string
): void {
  for (const match of template.matchAll(/\$\{([^}]+)\}/g)) {
    const expression = match[1]?.trim() ?? '';
    if (!isAllowedServiceClaimExpression(expression)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_CLAIMS_TEMPLATE_INVALID',
        `Service claims template "${template}" uses unsupported variable "${expression}".`,
        path,
        'Use only ctx.module, ctx.scope, ctx.auth, ctx.request, resource.<binding>.<field>, or allowlisted input.<field>.'
      );
    }
  }
}

function serviceHostnameIsPrivate(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    return true;
  }
  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function validateServiceEgressOrigin(
  diagnostics: ModuleDiagnostic[],
  origin: string,
  path: string
): void {
  if (!ORIGIN_PATTERN.test(origin) || origin.includes('*')) {
    addError(
      diagnostics,
      'MODULE_SERVICE_EGRESS_INVALID',
      `Service egress origin "${origin}" must be an explicit HTTPS origin.`,
      path,
      'Use an origin like "https://api.example.com".'
    );
    return;
  }
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:') {
    addError(
      diagnostics,
      'MODULE_SERVICE_EGRESS_INVALID',
      `Service egress origin "${origin}" must use HTTPS.`,
      path,
      'Use an HTTPS origin.'
    );
  }
  if (serviceHostnameIsPrivate(parsed.hostname)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_PRIVATE_NETWORK_FORBIDDEN',
      `Service egress origin "${origin}" points at a private network host.`,
      path,
      'Use a public HTTPS service origin or add a dedicated host-managed provider.'
    );
  }
}

export function validateServiceRequirement(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition,
  name: string,
  requirement: ServiceRequirement
): void {
  if (!SERVICE_NAME_PATTERN.test(name)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_NAME_INVALID',
      `Service requirement "${name}" must start with a letter and contain only letters, digits, and underscores.`,
      `serviceRequirements.${name}`
    );
  }
  if (requirement.required === true && !requirement.provider?.trim()) {
    addError(
      diagnostics,
      'MODULE_SERVICE_PROVIDER_REQUIRED',
      `Required service "${name}" must declare a provider.`,
      `serviceRequirements.${name}.provider`,
      'Declare provider: "openai", "stripe", "email-webhook", or another host provider id.'
    );
  }
  if (requirement.provider !== undefined && !requirement.provider.trim()) {
    addError(
      diagnostics,
      'MODULE_SERVICE_PROVIDER_EMPTY',
      `Service requirement "${name}" provider must not be empty when declared.`,
      `serviceRequirements.${name}.provider`
    );
  }

  if (requirement.kind !== undefined && !SERVICE_CONNECTION_KINDS.has(requirement.kind)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_CONNECTION_KIND_INVALID',
      `Service requirement "${name}" kind "${requirement.kind}" is not supported.`,
      `serviceRequirements.${name}.kind`,
      'Use kind: "signed-http".'
    );
  }

  const operations = requirement.operations ?? {};
  if (requirement.required === true && Object.keys(operations).length === 0) {
    addError(
      diagnostics,
      'MODULE_SERVICE_OPERATION_REQUIRED',
      `Required service "${name}" must declare at least one operation.`,
      `serviceRequirements.${name}.operations`,
      'Declare operation policies so runtime can enforce auth, signing, egress and redaction.'
    );
  }

  const signedHttp = requirement.kind === 'signed-http' || Object.keys(operations).length > 0;
  if (signedHttp) {
    const egress = requirement.connection?.egress ?? [];
    if (egress.length === 0) {
      addError(
        diagnostics,
        'MODULE_SERVICE_EGRESS_REQUIRED',
        `Signed HTTP service "${name}" must declare at least one HTTPS egress origin.`,
        `serviceRequirements.${name}.connection.egress`,
        'Declare egress: ["https://api.example.com"].'
      );
    }
    egress.forEach((origin, index) =>
      validateServiceEgressOrigin(
        diagnostics,
        origin,
        `serviceRequirements.${name}.connection.egress.${index}`
      )
    );
  }

  const declaredSecrets = new Set(Object.keys(requirement.secrets ?? {}));
  for (const [claimName, template] of Object.entries(requirement.claims ?? {})) {
    validateServiceClaimsTemplate(
      diagnostics,
      template,
      `serviceRequirements.${name}.claims.${claimName}`
    );
  }

  for (const [operationName, operation] of Object.entries(operations)) {
    validateServiceOperation(
      diagnostics,
      name,
      operationName,
      operation,
      requirement.claims ?? {},
      declaredSecrets
    );
  }

  if (requirement.connection?.retry?.backoff) {
    const backoff = requirement.connection.retry.backoff;
    if (!SERVICE_RETRY_BACKOFFS.has(backoff)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_RETRY_BACKOFF_INVALID',
        `Service requirement "${name}" retry backoff "${backoff}" is not supported.`,
        `serviceRequirements.${name}.connection.retry.backoff`,
        'Use none, linear, or exponential.'
      );
    }
  }
}

function validateServiceOperation(
  diagnostics: ModuleDiagnostic[],
  serviceName: string,
  operationName: string,
  operation: ModuleServiceOperationDefinition,
  claims: Record<string, string>,
  declaredSecrets: Set<string>
): void {
  const basePath = `serviceRequirements.${serviceName}.operations.${operationName}`;
  if (!SERVICE_OPERATION_PATTERN.test(operationName)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_OPERATION_NAME_INVALID',
      `Service operation "${serviceName}.${operationName}" must use a stable operation id.`,
      basePath,
      'Use names like "admin.request" or "runs.create".'
    );
  }
  if (operation.method !== undefined && !HTTP_METHODS.has(operation.method)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_OPERATION_METHOD_INVALID',
      `Service operation "${serviceName}.${operationName}" method "${operation.method}" is not supported.`,
      `${basePath}.method`
    );
  }
  if (operation.path !== undefined && !operation.path.startsWith('/')) {
    addError(
      diagnostics,
      'MODULE_SERVICE_OPERATION_PATH_INVALID',
      `Service operation "${serviceName}.${operationName}" path must start with "/".`,
      `${basePath}.path`
    );
  }
  validateServiceOperationInput(diagnostics, serviceName, operationName, operation, basePath);
  validateServiceOperationAuth(diagnostics, serviceName, operationName, operation, basePath, declaredSecrets);
  validateServiceOperationSigning(
    diagnostics,
    serviceName,
    operationName,
    operation,
    basePath,
    claims,
    declaredSecrets
  );
  validateServiceOperationBodies(diagnostics, serviceName, operationName, operation, basePath);
  validateServiceOperationHeaders(diagnostics, serviceName, operationName, operation, basePath);
}

function validateServiceOperationInput(
  diagnostics: ModuleDiagnostic[],
  serviceName: string,
  operationName: string,
  operation: ModuleServiceOperationDefinition,
  basePath: string
): void {
  for (const [index, field] of (operation.input?.allow ?? []).entries()) {
    if (!SERVICE_INPUT_FIELDS.has(field)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_INPUT_FIELD_INVALID',
        `Service operation "${serviceName}.${operationName}" allows unsupported input field "${field}".`,
        `${basePath}.input.allow.${index}`,
        'Use url, path, method, headers, query, body, or json.'
      );
    }
  }
  for (const [index, field] of (operation.input?.claimsAllow ?? []).entries()) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_CLAIMS_INPUT_FIELD_INVALID',
        `Service operation "${serviceName}.${operationName}" claimsAllow field "${field}" is not supported.`,
        `${basePath}.input.claimsAllow.${index}`,
        'Use top-level input field names like "workflowId".'
      );
    }
  }
}

function validateServiceOperationAuth(
  diagnostics: ModuleDiagnostic[],
  serviceName: string,
  operationName: string,
  operation: ModuleServiceOperationDefinition,
  basePath: string,
  declaredSecrets: Set<string>
): void {
  if (operation.auth && !SERVICE_AUTH_TYPES.has(operation.auth.type)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_AUTH_TYPE_INVALID',
      `Service operation "${serviceName}.${operationName}" auth type "${operation.auth.type}" is not supported.`,
      `${basePath}.auth.type`
    );
  }
  if (
    operation.auth?.type === 'bearer' &&
    (!operation.auth.secret || !declaredSecrets.has(operation.auth.secret))
  ) {
    addError(
      diagnostics,
      'MODULE_SERVICE_SECRET_REQUIRED',
      `Service operation "${serviceName}.${operationName}" bearer auth references an undeclared secret.`,
      `${basePath}.auth.secret`,
      'Declare the secret under serviceRequirements.<service>.secrets.'
    );
  }
  if (operation.auth?.header && !HTTP_HEADER_NAME_PATTERN.test(operation.auth.header)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_HEADER_INVALID',
      `Service operation "${serviceName}.${operationName}" auth header "${operation.auth.header}" is invalid.`,
      `${basePath}.auth.header`
    );
  }
}

function validateServiceOperationSigning(
  diagnostics: ModuleDiagnostic[],
  serviceName: string,
  operationName: string,
  operation: ModuleServiceOperationDefinition,
  basePath: string,
  claims: Record<string, string>,
  declaredSecrets: Set<string>
): void {
  if (operation.signing && !SERVICE_SIGNING_TYPES.has(operation.signing.type)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_SIGNING_TYPE_INVALID',
      `Service operation "${serviceName}.${operationName}" signing type "${operation.signing.type}" is not supported.`,
      `${basePath}.signing.type`
    );
  }
  if (
    operation.signing?.type === 'hmac-sha256' &&
    (!operation.signing.secret || !declaredSecrets.has(operation.signing.secret))
  ) {
    addError(
      diagnostics,
      'MODULE_SERVICE_SECRET_REQUIRED',
      `Service operation "${serviceName}.${operationName}" HMAC signing references an undeclared secret.`,
      `${basePath}.signing.secret`,
      'Declare the secret under serviceRequirements.<service>.secrets.'
    );
  }
  for (const [headerPath, header] of [
    ['header', operation.signing?.header],
    ['timestampHeader', operation.signing?.timestampHeader],
    ['claimsHeader', operation.signing?.claimsHeader],
  ] as const) {
    if (header && !HTTP_HEADER_NAME_PATTERN.test(header)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_HEADER_INVALID',
        `Service operation "${serviceName}.${operationName}" signing header "${header}" is invalid.`,
        `${basePath}.signing.${headerPath}`
      );
    }
  }
  for (const [index, field] of (operation.signing?.canonical ?? []).entries()) {
    if (!SERVICE_SIGNING_CANONICAL_FIELDS.has(field)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_SIGNING_CANONICAL_INVALID',
        `Service operation "${serviceName}.${operationName}" canonical signing field "${field}" is not supported.`,
        `${basePath}.signing.canonical.${index}`,
        'Use method, path, timestamp, bodySha256, or claimsSha256.'
      );
    }
  }
  if (
    operation.signing?.type === 'hmac-sha256' &&
    !Object.values(claims).includes('${ctx.request.id}')
  ) {
    addError(
      diagnostics,
      'MODULE_SERVICE_REQUEST_ID_REQUIRED',
      `Service operation "${serviceName}.${operationName}" HMAC claims must include ctx.request.id.`,
      `serviceRequirements.${serviceName}.claims`,
      'Add requestId: "${ctx.request.id}" to the service claims template.'
    );
  }
}

function validateServiceOperationBodies(
  diagnostics: ModuleDiagnostic[],
  serviceName: string,
  operationName: string,
  operation: ModuleServiceOperationDefinition,
  basePath: string
): void {
  if (operation.request?.body && !SERVICE_REQUEST_BODIES.has(operation.request.body)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_REQUEST_BODY_INVALID',
      `Service operation "${serviceName}.${operationName}" request body policy is not supported.`,
      `${basePath}.request.body`
    );
  }
  if (operation.response?.body && !SERVICE_RESPONSE_BODIES.has(operation.response.body)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_RESPONSE_BODY_INVALID',
      `Service operation "${serviceName}.${operationName}" response body policy is not supported.`,
      `${basePath}.response.body`
    );
  }
}

function validateServiceOperationHeaders(
  diagnostics: ModuleDiagnostic[],
  serviceName: string,
  operationName: string,
  operation: ModuleServiceOperationDefinition,
  basePath: string
): void {
  const managedServiceHeaders = operationManagedServiceHeaders(operation);
  for (const [index, header] of (operation.request?.allowHeaders ?? []).entries()) {
    if (!HTTP_HEADER_NAME_PATTERN.test(header)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_HEADER_INVALID',
        `Service operation "${serviceName}.${operationName}" has invalid allowed header "${header}".`,
        `${basePath}.request.allowHeaders.${index}`
      );
    }
    if (managedServiceHeaders.has(header.toLowerCase())) {
      addError(
        diagnostics,
        'MODULE_SERVICE_MANAGED_HEADER_DENIED',
        `Service operation "${serviceName}.${operationName}" cannot allow module-controlled header "${header}".`,
        `${basePath}.request.allowHeaders.${index}`,
        'Runtime manages auth, cookie and signature headers.'
      );
    }
  }
  for (const [index, header] of (operation.request?.denyHeaders ?? []).entries()) {
    if (header.trim() && !HTTP_HEADER_NAME_PATTERN.test(header)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_HEADER_INVALID',
        `Service operation "${serviceName}.${operationName}" has invalid denied header "${header}".`,
        `${basePath}.request.denyHeaders.${index}`
      );
    }
  }
  if (
    operation.request?.denyHeaders &&
    operation.request.denyHeaders.some((header) => !header.trim())
  ) {
    addError(
      diagnostics,
      'MODULE_SERVICE_DENY_HEADER_INVALID',
      `Service operation "${serviceName}.${operationName}" has an empty denied header.`,
      `${basePath}.request.denyHeaders`
    );
  }
}
