import { NextResponse } from 'next/server';
import { withAuth, withErrorHandling } from '@/lib/middleware';
import {
  listUserPluginTasks,
  pluginTaskListQuerySchema,
} from '@/lib/plugin-runtime/tasks/task-center.server';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(
  withAuth(async (request, context) => {
    const query = pluginTaskListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries())
    );
    const tasks = await listUserPluginTasks(context.auth.userId, query);
    return NextResponse.json({
      success: true,
      tasks,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        hasMore: tasks.length === query.limit,
      },
    });
  })
);
