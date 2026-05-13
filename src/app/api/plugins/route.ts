import { NextRequest, NextResponse } from 'next/server';
import { pluginRuntimeInstallerService } from '@/lib/plugin-runtime/installer';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import { withAdminGuard, withErrorHandling, type AuthContext } from '@/lib/middleware';
import { NotFoundError, ValidationError } from '@/lib/_core/errors';

/**
 * Unified endpoint for managing plugin installations and lifecycle.
 *
 * POST /api/plugins
 * Body: { action: string, pluginId?: string, data?: unknown }
 *
 * Supported actions:
 * - install: Install a plugin globally
 * - enable: Enable an installed plugin globally
 * - disable: Disable an enabled plugin globally
 * - uninstall: Uninstall a plugin globally
 * - list: List all installed plugins
 * - get: Get installation details for a specific plugin
 */

interface PluginActionRequest {
  action: 'install' | 'enable' | 'disable' | 'uninstall' | 'list' | 'get';
  pluginId?: string;
  data?: unknown;
}

/**
 * POST /api/plugins - Execute plugin management actions (Global)
 *
 * Admin only - Requires admin role to manage plugins
 */
// Type assertion needed for Next.js 15+ route handler validation
export const POST = withErrorHandling(
  withAdminGuard(async (request: NextRequest, context: { auth: AuthContext }) => {
    // 1. Get authenticated user from context (guaranteed to be admin)
    const userId = context.auth.userId;

    // 2. Parse request body
    const body = (await request.json()) as PluginActionRequest;
    const { action, pluginId } = body;

    // 3. Validate action
    const validActions = ['install', 'enable', 'disable', 'uninstall', 'list', 'get'];
    if (!action || !validActions.includes(action)) {
      throw new ValidationError(`Invalid action. Must be one of: ${validActions.join(', ')}`, {
        field: 'action',
        allowedActions: validActions,
      });
    }

    // 4. Validate pluginId for actions that require it
    if (action !== 'list' && !pluginId) {
      throw new ValidationError(`pluginId is required for action "${action}"`, {
        field: 'pluginId',
        action,
      });
    }

    // 5. Execute action (global operations)
    switch (action) {
      case 'install': {
        const result = await pluginRuntimeInstallerService.installPlugin(pluginId!, userId);

        if (!result.success) {
          throw new ValidationError(result.error ?? `Failed to install plugin "${pluginId}"`, {
            action,
            pluginId,
          });
        }

        return NextResponse.json({
          success: true,
          message: `Plugin "${pluginId}" installed globally`,
          installation: result.installation,
        });
      }

      case 'enable': {
        const result = await pluginRuntimeInstallerService.enablePlugin(pluginId!, userId);

        return NextResponse.json({
          success: true,
          message: `Plugin "${pluginId}" enabled globally`,
          installation: result.installation,
        });
      }

      case 'disable': {
        const result = await pluginRuntimeInstallerService.disablePlugin(pluginId!, userId);

        return NextResponse.json({
          success: true,
          message: `Plugin "${pluginId}" disabled globally`,
          installation: result.installation,
        });
      }

      case 'uninstall': {
        const result = await pluginRuntimeInstallerService.uninstallPlugin(pluginId!, userId);

        return NextResponse.json({
          success: true,
          message: `Plugin "${pluginId}" uninstalled globally`,
          installation: result.installation,
        });
      }

      case 'list': {
        const installations = await pluginQueryService.listInstalledPlugins();

        return NextResponse.json({
          success: true,
          total: installations.length,
          installations,
        });
      }

      case 'get': {
        const installation = await pluginQueryService.getInstallation(pluginId!);

        if (!installation) {
          throw new NotFoundError('Plugin installation', pluginId);
        }

        return NextResponse.json({
          success: true,
          installation,
        });
      }

      default:
        throw new ValidationError('Invalid action', {
          field: 'action',
          allowedActions: validActions,
        });
    }
  })
) as unknown as (request: NextRequest) => Promise<Response>;
