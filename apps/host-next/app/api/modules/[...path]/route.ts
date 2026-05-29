import { getModuleHost } from '@host/lib/module-host';
import { modulePathFromSegments } from '@host/lib/paths';
import { checkHostRouteSecurity } from '@host/lib/security';

interface ModuleApiRouteContext {
  params: Promise<{
    path?: string[];
  }>;
}

async function dispatch(request: Request, context: ModuleApiRouteContext): Promise<Response> {
  const securityResponse = await checkHostRouteSecurity(request, 'module.api');
  if (securityResponse) {
    return securityResponse;
  }

  const host = await getModuleHost();
  const { path } = await context.params;
  return host.dispatchApiRoute({
    request,
    pathname: modulePathFromSegments(path),
  });
}

export function GET(request: Request, context: ModuleApiRouteContext) {
  return dispatch(request, context);
}

export function POST(request: Request, context: ModuleApiRouteContext) {
  return dispatch(request, context);
}

export function PUT(request: Request, context: ModuleApiRouteContext) {
  return dispatch(request, context);
}

export function PATCH(request: Request, context: ModuleApiRouteContext) {
  return dispatch(request, context);
}

export function DELETE(request: Request, context: ModuleApiRouteContext) {
  return dispatch(request, context);
}
