import { handleAdminResourcesGet } from '@host/lib/admin-resource-route';
import { getModuleHost } from '@host/lib/module-host';

export async function GET(request: Request) {
  return handleAdminResourcesGet(request, { getModuleHost });
}
