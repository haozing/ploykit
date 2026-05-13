import { NextRequest } from 'next/server';
import { handlePluginApiRuntime } from '@/lib/plugin-runtime';
import { withErrorHandling } from '@/lib/middleware';
import { NotFoundError } from '@/lib/_core/errors';

interface RouteContext {
  params: Promise<{
    slug: string[];
  }>;
}

export const GET = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleApi(request, context)
);

export const POST = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleApi(request, context)
);

export const PUT = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleApi(request, context)
);

export const DELETE = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleApi(request, context)
);

export const PATCH = withErrorHandling((request: NextRequest, context: RouteContext) =>
  handleApi(request, context)
);

async function handleApi(request: NextRequest, context: RouteContext): Promise<Response> {
  const { slug } = await context.params;
  const pluginId = slug[0];
  const apiRoute = slug.slice(1);

  if (!pluginId) {
    throw new NotFoundError('Plugin API route');
  }

  return handlePluginApiRuntime(request, pluginId, apiRoute);
}
