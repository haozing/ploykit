import type { ModuleHostSession } from '@/lib/module-runtime';
import { createHostSessionForUser } from './auth';
import {
  DEFAULT_HOST_ADMIN_USER_ID,
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from './default-scope';

export function createDemoHostSession(): ModuleHostSession {
  return createHostSessionForUser({
    id: DEFAULT_HOST_ADMIN_USER_ID,
    email: 'admin@example.com',
    role: 'admin',
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    workspaceRole: 'owner',
  });
}
