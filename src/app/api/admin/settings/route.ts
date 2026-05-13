import { NextResponse } from 'next/server';
import {
  withAdminGuard,
  withBodyValidation,
  withErrorHandling,
  type AuthContext,
} from '@/lib/middleware';
import { getClientIP, getUserAgent } from '@/lib/shared/api-helpers';
import {
  getSystemSettingMetadata,
  getSystemSettings,
  updateSystemSettings,
} from '@/lib/services/system-settings/system-settings-service';
import { systemSettingsPayloadSchema } from '@/lib/validations/system-settings';
import { AUDIT_ACTIONS, auditLogSync } from '@/lib/services/audit/audit-service';

export const GET = withAdminGuard(
  withErrorHandling(async () => {
    const [settings, metadata] = await Promise.all([
      getSystemSettings(),
      getSystemSettingMetadata(),
    ]);

    return NextResponse.json({
      success: true,
      data: settings,
      metadata,
    });
  })
);

export const PUT = withAdminGuard(
  withErrorHandling(
    withBodyValidation(systemSettingsPayloadSchema, async (request, context) => {
      const { auth, validated } = context as typeof context & { auth: AuthContext };
      const settings = validated.body!;
      const previous = await getSystemSettings();
      const updated = await updateSystemSettings(settings, auth.userId);

      await auditLogSync({
        userId: auth.userId,
        userEmail: auth.userEmail,
        action: AUDIT_ACTIONS.SYSTEM_CONFIG_UPDATE,
        resource: 'system_settings',
        resourceId: 'platform',
        resourceName: 'Platform settings',
        ipAddress: getClientIP(request),
        userAgent: getUserAgent(request),
        status: 'success',
        metadata: {
          before: previous,
          after: updated,
        },
      });

      return NextResponse.json({
        success: true,
        data: updated,
      });
    })
  )
);
