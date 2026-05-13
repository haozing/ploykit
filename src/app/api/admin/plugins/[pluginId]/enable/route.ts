import { NextResponse } from 'next/server';
import { withAdminGuard, withErrorHandling, withParamsValidation } from '@/lib/middleware';
import { pluginIdParamsSchema } from '@/lib/validations/plugin';
import { pluginRuntimeInstallerService } from '@/lib/plugin-runtime/installer';
import { logger } from '@/lib/_core/logger';
import { ValidationError } from '@/lib/_core/errors';

export const POST = withAdminGuard(
  withErrorHandling(
    withParamsValidation(pluginIdParamsSchema, async (_request, context) => {
      const { validated } = context;
      const { pluginId } = validated.params!;

      logger.info({ pluginId }, 'Admin requesting to enable plugin');

      const result = await pluginRuntimeInstallerService.enablePlugin(pluginId);

      if (!result.success) {
        throw new ValidationError(result.error || 'Failed to enable plugin');
      }

      logger.info({ pluginId }, 'Plugin enabled successfully');
      return NextResponse.json({ success: true }, { status: 200 });
    })
  )
);
