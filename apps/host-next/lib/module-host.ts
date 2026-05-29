import type { ModuleHost } from '@/lib/module-runtime';
import { getHostModuleHost } from './create-host';
import { createDemoHostSession } from './session';

export function getModuleHost(): Promise<ModuleHost> {
  return getHostModuleHost();
}

export { createDemoHostSession };
