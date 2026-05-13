/**
 * Plugin Validation Schemas
 *
 * Schemas for plugin management endpoints
 */

import { z } from 'zod';

/**
 * Plugin ID Parameter Schema
 *
 * For routes: /api/admin/plugins/[pluginId]/*
 */
export const pluginIdParamsSchema = z.object({
  pluginId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-_]+$/, {
      message: 'Plugin ID must contain only lowercase letters, numbers, hyphens, and underscores',
    })
    .describe('Plugin identifier'),
});

export type PluginIdParams = z.infer<typeof pluginIdParamsSchema>;
