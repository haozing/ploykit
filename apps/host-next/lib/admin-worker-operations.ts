import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import {
  drainHostWorker,
  getHostWorkerStatus,
  type HostWorkerStatusSnapshot,
} from './worker';

export type AdminWorkerRuntimeStatus = Pick<
  HostWorkerStatusSnapshot,
  'workerId' | 'heartbeatAt' | 'lastDrainAt' | 'queue' | 'alerts'
>;

export type AdminWorkerDrainResult = Awaited<ReturnType<typeof drainHostWorker>>;

export async function getAdminWorkerRuntimeStatus(): Promise<AdminWorkerRuntimeStatus> {
  const status = await getHostWorkerStatus();
  return {
    workerId: status.workerId,
    heartbeatAt: status.heartbeatAt,
    lastDrainAt: status.lastDrainAt,
    queue: status.queue,
    alerts: status.alerts,
  };
}

export function drainAdminWorker(
  session: ModuleHostSession,
  input: {
    limit?: number;
    concurrency?: number;
    leaseMs?: number;
    retryBackoffMs?: number;
    workerId?: string;
  } = {}
): Promise<AdminWorkerDrainResult> {
  return drainHostWorker({ session, ...input });
}
