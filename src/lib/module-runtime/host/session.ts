import type { ModuleUser } from '@ploykit/module-sdk';
import type { ModuleDataRuntimeSession } from '../data';
import {
  createAnonymousModuleRuntimeAccessSession,
  type ModuleRuntimeAccessSession,
} from '../security';

export interface ModuleHostSession extends ModuleRuntimeAccessSession {
  user: ModuleUser | null;
  data?: ModuleDataRuntimeSession | null;
  requestId?: string;
}

export interface ResolveModuleHostSessionInput {
  operation: 'api' | 'action' | 'page';
  request: Request;
  pathname?: string;
  routeKind?: 'site' | 'dashboard' | 'admin';
  moduleId?: string;
  actionName?: string;
  params: Record<string, string>;
}

export type ModuleHostSessionResolver = (
  input: ResolveModuleHostSessionInput
) => ModuleHostSession | Promise<ModuleHostSession>;

export function createAnonymousModuleHostSession(): ModuleHostSession {
  return {
    ...createAnonymousModuleRuntimeAccessSession(),
    data: null,
  };
}
