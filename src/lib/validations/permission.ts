import { z } from 'zod';

/**
 * Permission Validation Schemas
 */

// Permission identifier format: resource:action:scope
export const permissionIdentifierSchema = z
  .string()
  .regex(
    /^[a-z_*]+:[a-z_*]+:[a-z_*]+$/,
    'Permission must be in format: resource:action:scope (lowercase, underscores, or * allowed)'
  );

// Permission component schema (single part)
const permissionComponentSchema = z
  .string()
  .min(1, 'Component cannot be empty')
  .max(50, 'Component must not exceed 50 characters')
  .regex(/^[a-z_*]+$/, 'Component must be lowercase with underscores or *');

// Create permission schema
export const createPermissionSchema = z.object({
  resource: permissionComponentSchema,
  action: permissionComponentSchema,
  scope: permissionComponentSchema,
  description: z.string().max(500, 'Description must not exceed 500 characters').optional(),
});

export type CreatePermissionInput = z.infer<typeof createPermissionSchema>;

// Permission filters schema
export const permissionFiltersSchema = z.object({
  search: z.string().min(1).max(100).optional(),
  resource: permissionComponentSchema.optional(),
});

export type PermissionFiltersInput = z.infer<typeof permissionFiltersSchema>;

// Parse permission components
export const parsePermissionSchema = z.object({
  identifier: permissionIdentifierSchema,
});

export type ParsePermissionInput = z.infer<typeof parsePermissionSchema>;
