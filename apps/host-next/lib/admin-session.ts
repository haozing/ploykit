import type { ModuleHostSession } from '@/lib/module-runtime/host/session';

export function assertAdminSession(session: ModuleHostSession) {
  if (session.user?.role !== 'admin' && !session.system) {
    throw new Error('ADMIN_OPERATION_FORBIDDEN');
  }
}
