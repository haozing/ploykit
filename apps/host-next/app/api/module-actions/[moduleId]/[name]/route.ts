import { getModuleHost } from '@host/lib/module-host';
import { handleModuleActionPost } from '@host/lib/module-action-route';
import { checkHostRouteSecurity } from '@host/lib/security';

interface ModuleActionRouteContext {
  params: Promise<{
    moduleId: string;
    name: string;
  }>;
}

export async function POST(request: Request, context: ModuleActionRouteContext) {
  return handleModuleActionPost(request, context, {
    getModuleHost,
    checkHostRouteSecurity,
  });
}
