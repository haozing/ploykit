import { db } from '@/lib/db';
import { permissions } from '@/lib/db/schema';
import { eq, like, or, and } from 'drizzle-orm';
import { ValidationError, ConflictError } from '@/lib/_core/errors';
import {
  createPermissionSchema,
  permissionFiltersSchema,
  permissionIdentifierSchema,
  type CreatePermissionInput,
  type PermissionFiltersInput,
} from '@/lib/validations';

/**
 * Permission Service
 *
 * Manages permission definitions:
 * - List available permissions
 * - Create custom permissions
 * - Permission structure: resource:action:scope
 * - Permission validation
 */

export interface Permission {
  id: string;
  resource: string;
  action: string;
  scope: string;
  identifier: string;
  description: string | null;
  createdAt: Date;
}

/**
 * Predefined permission templates
 * These are common permissions that can be used across the platform
 */
export const PERMISSION_TEMPLATES = {
  // Platform administration permissions
  ADMIN_ACCESS: 'admin:access:all',
  USER_MANAGE: 'user:manage:all',
  ROLE_MANAGE: 'role:manage:all',
  PLAN_MANAGE: 'plan:manage:all',
  SYSTEM_CONFIG: 'system:config:all',

  // Profile/account permissions
  PROFILE_VIEW: 'profile:view:self',
  PROFILE_EDIT: 'profile:edit:self',
  ACCOUNT_MANAGE: 'account:manage:self',

  // User permissions
  USER_CREATE: 'user:create:own',
  USER_READ: 'user:read:own',
  USER_UPDATE: 'user:update:own',
  USER_DELETE: 'user:delete:own',
  USER_ALL: 'user:*:own',

  // Role permissions
  ROLE_CREATE: 'role:create:own',
  ROLE_READ: 'role:read:own',
  ROLE_UPDATE: 'role:update:own',
  ROLE_DELETE: 'role:delete:own',
  ROLE_ASSIGN: 'role:assign:own',
  ROLE_ALL: 'role:*:own',

  // Plugin permissions
  PLUGIN_INSTALL: 'plugin:install:own',
  PLUGIN_UNINSTALL: 'plugin:uninstall:own',
  PLUGIN_CONFIGURE: 'plugin:configure:own',
  PLUGIN_READ: 'plugin:read:own',
  PLUGIN_ALL: 'plugin:*:own',

  // API permissions
  API_READ: 'api:read:own',
  API_WRITE: 'api:write:own',
  API_ALL: 'api:*:own',

  // Billing permissions
  BILLING_READ: 'billing:read:own',
  BILLING_UPDATE: 'billing:update:own',
  BILLING_ALL: 'billing:*:own',
  BILLING_MANAGE: 'billing:manage:all',
  INVOICE_READ: 'invoice:read:own',
  INVOICE_MANAGE: 'invoice:manage:all',
  PAYMENT_METHOD_READ: 'payment_method:read:own',
  PAYMENT_METHOD_MANAGE: 'payment_method:manage:all',
  TAX_PROFILE_READ: 'tax_profile:read:own',
  TAX_PROFILE_MANAGE: 'tax_profile:manage:all',
  CREDIT_READ: 'credit:read:own',
  CREDIT_MANAGE: 'credit:manage:all',
  CREDIT_RECONCILE: 'credit:reconcile:all',

  // Audit log permissions
  AUDIT_READ: 'audit:read:own',
  AUDIT_ALL: 'audit:*:own',
  AUDIT_EXPORT: 'audit:export:all',
  AUDIT_RETENTION: 'audit:retention:all',

  // File administration
  FILE_READ: 'file:read:own',
  FILE_MANAGE: 'file:manage:all',
  FILE_RETENTION: 'file:retention:all',

  // Reliability/operations
  OUTBOX_MANAGE: 'outbox:manage:all',
  WEBHOOK_RETRY: 'webhook:retry:all',
  RELIABILITY_READ: 'reliability:read:all',
  EDGE_ACCESS_LOG_INGEST: 'edge_access_log:ingest:all',
  EDGE_ACCESS_LOG_READ: 'edge_access_log:read:all',

  // Super admin (full access)
  SUPER_ADMIN: '*:*:*',
} as const;

/**
 * Permission descriptions
 *
 * User-level architecture: "own" scope refers to user's own resources
 */
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'admin:access:all': 'Access the admin console',
  'user:manage:all': 'Manage users, including suspend, restore, and password reset',
  'role:manage:all': 'Manage roles and permissions',
  'plan:manage:all': 'Manage plans and entitlements',
  'system:config:all': 'Manage system configuration',

  'profile:view:self': 'View own profile',
  'profile:edit:self': 'Edit own profile',
  'account:manage:self': 'Manage own account settings',

  'user:create:own': 'Create user accounts',
  'user:read:own': 'View user information',
  'user:update:own': 'Update user accounts',
  'user:delete:own': 'Delete user accounts',
  'user:*:own': 'Full user management access',

  'role:create:own': 'Create roles',
  'role:read:own': 'View roles',
  'role:update:own': 'Update roles',
  'role:delete:own': 'Delete roles',
  'role:assign:own': 'Assign roles to users',
  'role:*:own': 'Full role management access',

  'plugin:install:own': 'Install plugins',
  'plugin:uninstall:own': 'Uninstall plugins',
  'plugin:configure:own': 'Configure plugin settings',
  'plugin:read:own': 'View installed plugins',
  'plugin:*:own': 'Full plugin access',

  'api:read:own': 'Read API resources',
  'api:write:own': 'Write API resources',
  'api:*:own': 'Full API access',

  'billing:read:own': 'View billing information',
  'billing:update:own': 'Update billing settings',
  'billing:*:own': 'Full billing access',
  'billing:manage:all': 'Manage platform billing records',
  'invoice:read:own': 'View own invoices',
  'invoice:manage:all': 'Manage invoices',
  'payment_method:read:own': 'View own payment methods',
  'payment_method:manage:all': 'Manage payment methods',
  'tax_profile:read:own': 'View own tax profile',
  'tax_profile:manage:all': 'Manage tax profiles',
  'credit:read:own': 'View own credit ledger',
  'credit:manage:all': 'Manage credit ledger entries',
  'credit:reconcile:all': 'Run credit reconciliation',

  'audit:read:own': 'View audit logs',
  'audit:*:own': 'Full audit log access',
  'audit:export:all': 'Export audit logs',
  'audit:retention:all': 'Apply audit log retention policy',

  'file:read:own': 'Read own files',
  'file:manage:all': 'Manage all platform files',
  'file:retention:all': 'Run file retention policy',

  'outbox:manage:all': 'Replay, ignore, and archive outbox dead letters',
  'webhook:retry:all': 'Retry webhook receipts',
  'reliability:read:all': 'View reliability analytics',
  'edge_access_log:ingest:all': 'Ingest external API gateway access logs',
  'edge_access_log:read:all': 'View external API gateway access logs',

  '*:*:*': 'Full platform access (Super Admin)',
};

export function normalizePermissionIdentifier(identifier: string): string {
  return identifier;
}

/**
 * Parse permission identifier into components
 */
export function parsePermission(identifier: string): {
  resource: string;
  action: string;
  scope: string;
} {
  const normalizedIdentifier = normalizePermissionIdentifier(identifier);

  // Validate format
  const result = permissionIdentifierSchema.safeParse(normalizedIdentifier);

  if (!result.success) {
    throw new ValidationError('Invalid permission format. Expected: resource:action:scope', {
      identifier,
      normalizedIdentifier,
      issues: result.error.issues,
    });
  }

  const parts = normalizedIdentifier.split(':');

  return {
    resource: parts[0],
    action: parts[1],
    scope: parts[2],
  };
}

/**
 * Build permission identifier from components
 */
export function buildPermission(resource: string, action: string, scope: string): string {
  return `${resource}:${action}:${scope}`;
}

/**
 * Validate permission format
 */
export function validatePermission(identifier: string): boolean {
  try {
    parsePermission(identifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all permissions
 */
export async function listPermissions(filters: PermissionFiltersInput = {}) {
  // Validate input
  const validatedFilters = permissionFiltersSchema.parse(filters);
  const { search, resource } = validatedFilters;

  const conditions = [];

  if (search) {
    conditions.push(
      or(like(permissions.identifier, `%${search}%`), like(permissions.description, `%${search}%`))
    );
  }

  if (resource) {
    conditions.push(eq(permissions.resource, resource));
  }

  // Build where clause
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Execute query
  const permissionsList = await db
    .select()
    .from(permissions)
    .where(whereClause)
    .orderBy(permissions.resource, permissions.action, permissions.scope);

  return permissionsList;
}

/**
 * Get permission by identifier
 */
export async function getPermissionByIdentifier(identifier: string): Promise<Permission | null> {
  const permission = await db.query.permissions.findFirst({
    where: eq(permissions.identifier, identifier),
  });

  return permission || null;
}

/**
 * Create a new permission definition
 */
export async function createPermission(data: CreatePermissionInput) {
  // Validate input
  const validatedData = createPermissionSchema.parse(data);

  const identifier = buildPermission(
    validatedData.resource,
    validatedData.action,
    validatedData.scope
  );

  // Check if permission already exists
  const existing = await getPermissionByIdentifier(identifier);

  if (existing) {
    throw new ConflictError('Permission already exists', {
      identifier,
      existingId: existing.id,
    });
  }

  const [newPermission] = await db
    .insert(permissions)
    .values({
      resource: validatedData.resource,
      action: validatedData.action,
      scope: validatedData.scope,
      identifier,
      description: validatedData.description,
      createdAt: new Date(),
    })
    .returning();

  return newPermission;
}

/**
 * Get all available resources
 */
export async function getAvailableResources(): Promise<string[]> {
  const result = await db.selectDistinct({ resource: permissions.resource }).from(permissions);

  return result.map((r) => r.resource);
}

/**
 * Get all available actions for a resource
 */
export async function getAvailableActions(resource: string): Promise<string[]> {
  const result = await db
    .selectDistinct({ action: permissions.action })
    .from(permissions)
    .where(eq(permissions.resource, resource));

  return result.map((a) => a.action);
}

/**
 * Get permissions grouped by resource
 */
export async function getPermissionsGroupedByResource() {
  const allPermissions = await listPermissions();

  const grouped: Record<string, Permission[]> = {};

  allPermissions.forEach((perm) => {
    if (!grouped[perm.resource]) {
      grouped[perm.resource] = [];
    }
    grouped[perm.resource].push(perm);
  });

  return grouped;
}

/**
 * Check if permission matches pattern
 * Supports wildcards: *, e.g., user:*:own matches user:create:own
 */
export function permissionMatches(userPermission: string, requiredPermission: string): boolean {
  const normalizedUserPermission = normalizePermissionIdentifier(userPermission);
  const normalizedRequiredPermission = normalizePermissionIdentifier(requiredPermission);

  // Full access wildcard
  if (normalizedUserPermission === '*:*:*') {
    return true;
  }

  if (
    !validatePermission(normalizedUserPermission) ||
    !validatePermission(normalizedRequiredPermission)
  ) {
    return false;
  }

  const [userResource, userAction, userScope] = normalizedUserPermission.split(':');
  const [reqResource, reqAction, reqScope] = normalizedRequiredPermission.split(':');

  return (
    (userResource === reqResource || userResource === '*') &&
    (userAction === reqAction || userAction === '*') &&
    (userScope === reqScope || userScope === '*')
  );
}

/**
 * Get permission description
 */
export function getPermissionDescription(identifier: string): string {
  const normalizedIdentifier = normalizePermissionIdentifier(identifier);
  return PERMISSION_DESCRIPTIONS[normalizedIdentifier] || normalizedIdentifier;
}

/**
 * Get all predefined permission templates
 */
export function getPermissionTemplates() {
  return Object.entries(PERMISSION_TEMPLATES).map(([key, value]) => ({
    key,
    identifier: value,
    description: PERMISSION_DESCRIPTIONS[value] || value,
    ...parsePermission(value),
  }));
}
