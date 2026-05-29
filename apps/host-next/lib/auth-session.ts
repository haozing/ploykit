import type { ModuleHostSession } from '@/lib/module-runtime';
import { resolveHostSessionFromRequest } from './auth';
import { createDemoHostSession } from './session';

export type HostSessionSource = 'request-cookie' | 'demo-fixture';

export interface ResolvedHostSession {
  session: ModuleHostSession;
  source: HostSessionSource;
}

export async function resolveHostRequestSession(request: Request): Promise<ResolvedHostSession> {
  return {
    session: await resolveHostSessionFromRequest(request),
    source: 'request-cookie',
  };
}

export function createFixtureHostSession(): ResolvedHostSession {
  return {
    session: createDemoHostSession(),
    source: 'demo-fixture',
  };
}
