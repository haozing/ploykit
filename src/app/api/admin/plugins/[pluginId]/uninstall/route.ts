/**
 * ════════════════════════════════════════════════════════════
 * UninstallPlugin API
 * ════════════════════════════════════════════════════════════
 *
 * DELETE /api/admin/plugins/[pluginId]/uninstall
 *
 * Feature：
 * - Uninstall指定ofPlugin
 * - 执行 onUninstall 生命Cycle hook
 * - DeleteDataTable（ifDefine了 dataModels）
 * - DeleteInstallRecord
 * - 此操作不可逆，AllData将be永久Delete
 *
 * P1 SECURITY ENDPOINT
 * Full validation with type safety
 * Protected with admin guard
 *
 * 🔒 Permission：Admin
 *
 * 前置件：
 * - Plugin必须处atDisableStatus（enabled=false）
 */

import { NextResponse } from 'next/server';
import { withAdminGuard, withErrorHandling, withParamsValidation } from '@/lib/middleware';
import { pluginIdParamsSchema } from '@/lib/validations/plugin';
import { pluginRuntimeInstallerService } from '@/lib/plugin-runtime/installer';
import { logger } from '@/lib/_core/logger';
import { ValidationError } from '@/lib/_core/errors';

export const DELETE = withAdminGuard(
  withErrorHandling(
    withParamsValidation(pluginIdParamsSchema, async (request, context) => {
      const { validated } = context;
      const { pluginId } = validated.params!;

      logger.info({ pluginId }, 'Admin requesting to uninstall plugin');

      // Uninstall操作
      const result = await pluginRuntimeInstallerService.uninstallPlugin(pluginId);

      if (result.success) {
        logger.info({ pluginId }, 'Plugin uninstalled successfully');
        return NextResponse.json({ success: true }, { status: 200 });
      } else {
        throw new ValidationError(result.error || 'Failed to uninstall plugin');
      }
    })
  )
);
