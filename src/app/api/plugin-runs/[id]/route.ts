import { NextResponse } from 'next/server';
import { withAuth, withErrorHandling } from '@/lib/middleware';
import {
  getUserPluginTask,
  pluginTaskParamsSchema,
} from '@/lib/plugin-runtime/tasks/task-center.server';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(
  withAuth(async (_request, context) => {
    const params = pluginTaskParamsSchema.parse(await context.params);
    const task = await getUserPluginTask(context.auth.userId, params.id);
    return NextResponse.json({ success: true, task });
  })
);
