/**
 * File Validation Schemas
 *
 * Schemas for file management endpoints
 */

import { z } from 'zod';

export const fileIdSchema = z
  .string()
  .min(1, 'File ID is required')
  .max(128, 'File ID is too long')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid file ID format');

/**
 * File ID Parameter Schema
 *
 * For routes: /api/admin/files/[id]
 */
export const fileIdParamsSchema = z.object({
  id: fileIdSchema.describe('File ID'),
});

export type FileIdParams = z.infer<typeof fileIdParamsSchema>;

/**
 * File Download Query Schema
 *
 * For GET /api/admin/files/[id]?download=true
 */
export const fileDownloadQuerySchema = z.object({
  download: z.enum(['true', 'false']).optional().describe('Whether to download the file'),
});

export type FileDownloadQuery = z.infer<typeof fileDownloadQuerySchema>;
