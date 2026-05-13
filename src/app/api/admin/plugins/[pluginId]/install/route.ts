/**
 * ════════════════════════════════════════════════════════════
 * InstallPlugin API
 * ════════════════════════════════════════════════════════════
 *
 * POST /api/admin/plugins/[pluginId]/install
 *
 * Feature：
 * - Install指定ofPlugin
 * - ValidationPluginWhether存at
 * - CreateDataTable（ifDefine了 dataModels）
 * - 执行 onInstall 生命Cycle hook
 * - 初始StatusasDisable（enabled=false）
 *
 * P1 SECURITY ENDPOINT
 * Full validation with type safety
 * Protected with admin guard
 *
 * 🔒 Permission：Admin
 */

import { NextResponse } from 'next/server';
import {
  withAdminGuard,
  withErrorHandling,
  withParamsValidation,
  type AuthContext,
} from '@/lib/middleware';
import { pluginIdParamsSchema } from '@/lib/validations/plugin';
import { pluginRuntimeInstallerService } from '@/lib/plugin-runtime/installer';
import { logger } from '@/lib/_core/logger';
import { ValidationError } from '@/lib/_core/errors';

export const POST = withAdminGuard(
  withErrorHandling(
    withParamsValidation(pluginIdParamsSchema, async (request, context) => {
      const { validated, auth } = context as typeof context & { auth: AuthContext };
      const { pluginId } = validated.params!;

      logger.info({ pluginId }, 'Admin requesting to install plugin');

      // Use userId from auth context (already authenticated by withAdminGuard)
      const userId = auth.userId;

      // Install操作
      const result = await pluginRuntimeInstallerService.installPlugin(pluginId, userId);

      if (result.success) {
        logger.info(
          { pluginId, installation: result.installation },
          'Plugin installed successfully'
        );
        return NextResponse.json(
          {
            success: true,
            installation: result.installation,
          },
          { status: 200 }
        );
      } else {
        throw new ValidationError(result.error || 'Failed to install plugin');
      }
    })
  )
);
