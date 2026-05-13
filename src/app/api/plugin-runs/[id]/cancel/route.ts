import { NextResponse } from 'next/server';
import { withAuth, withErrorHandling } from '@/lib/middleware';
import {
  pluginRunCancelSchema,
  pluginTaskParamsSchema,
  requestUserPluginTaskCancel,
} from '@/lib/plugin-runtime/tasks/task-center.server';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  withAuth(async (request, context) => {
    const params = pluginTaskParamsSchema.parse(await context.params);
    const body = pluginRunCancelSchema.parse(await request.json().catch(() => ({})));
    const task = await requestUserPluginTaskCancel(context.auth.userId, params.id, body.reason);
    return NextResponse.json({ success: true, task });
  })
);
