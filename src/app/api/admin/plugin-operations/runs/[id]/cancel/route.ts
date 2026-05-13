import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/middleware';
import type { RouteContext } from '@/lib/middleware/api-error-handler';
import {
  pluginRunCancelSchema,
  pluginTaskParamsSchema,
  requestAdminPluginTaskCancel,
} from '@/lib/plugin-runtime/tasks/task-center.server';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(
  async (request: NextRequest, context: RouteContext<{ id: string }>) => {
    const params = pluginTaskParamsSchema.parse(await context.params);
    const body = pluginRunCancelSchema.parse(await request.json().catch(() => ({})));
    const task = await requestAdminPluginTaskCancel(params.id, body.reason);
    return NextResponse.json({ success: true, task });
  }
);
