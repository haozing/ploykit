import { NextRequest } from 'next/server';
import { handlePluginWebhookRuntime } from '@/lib/plugin-runtime';
import { withErrorHandling } from '@/lib/middleware';
import { NotFoundError } from '@/lib/_core/errors';

interface RouteContext {
  params: Promise<{
    pluginId: string;
    path?: string[];
  }>;
}

export const GET = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleWebhook(request, context)
);

export const POST = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleWebhook(request, context)
);

export const PUT = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleWebhook(request, context)
);

export const DELETE = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleWebhook(request, context)
);

export const PATCH = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleWebhook(request, context)
);

async function handleWebhook(request: NextRequest, context: RouteContext): Promise<Response> {
  const { pluginId, path = [] } = await context.params;

  if (!pluginId) {
    throw new NotFoundError('Plugin webhook route');
  }

  return handlePluginWebhookRuntime(request, pluginId, path);
}
