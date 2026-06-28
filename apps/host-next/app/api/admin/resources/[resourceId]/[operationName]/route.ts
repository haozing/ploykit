import {
  handleAdminResourceOperationPost,
  type AdminResourceRouteContext,
} from '@host/lib/admin-resource-route';
import { getModuleHost } from '@host/lib/module-host';

export async function POST(request: Request, context: AdminResourceRouteContext) {
  return handleAdminResourceOperationPost(request, context, { getModuleHost });
}
