/**
 * Role Input Validation Schemas
 *
 * Validates role and permission-related inputs using Zod
 */

import { z } from 'zod';

/**
 * Permission format validation
 * Format: resource:action:scope (e.g., user:read:own or user:*:own for wildcards)
 */
export const permissionSchema = z
  .string()
  .regex(
    /^[a-z_*]+:[a-z_*]+:[a-z_*]+$/,
    'Permission must be in format: resource:action:scope (lowercase, underscores, or * allowed)'
  );

/**
 * Role slug validation
 */
export const roleSlugSchema = z
  .string()
  .min(2, 'Role slug must be at least 2 characters')
  .max(50, 'Role slug must be less than 50 characters')
  .regex(/^[a-z0-9_]+$/, 'Role slug must be lowercase alphanumeric with underscores only');

/**
 * Role name validation
 */
export const roleNameSchema = z
  .string()
  .min(2, 'Role name must be at least 2 characters')
  .max(100, 'Role name must be less than 100 characters');

/**
 * Create role input schema
 */
export const createRoleSchema = z.object({
  name: roleNameSchema,
  slug: roleSlugSchema,
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  permissions: z.array(permissionSchema).default([]),
  isDefault: z.boolean().default(false),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * Update role input schema
 */
export const updateRoleSchema = z.object({
  name: roleNameSchema.optional(),
  slug: roleSlugSchema.optional(),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  permissions: z.array(permissionSchema).optional(),
  isDefault: z.boolean().optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/**
 * Assign role to user input schema
 */
export const assignRoleSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  roleId: z.string().uuid('Invalid role ID'),
  expiresAt: z.date().optional(),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

/**
 * Role filters schema
 */
export const roleFiltersSchema = z.object({
  search: z.string().min(2, 'Search query must be at least 2 characters').optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type RoleFiltersInput = z.infer<typeof roleFiltersSchema>;
