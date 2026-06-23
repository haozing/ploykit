import type { ModulePageRoute } from '@ploykit/module-sdk';
import type { ResolvedModulePageEffectiveRoute } from '../adapters';

export interface ModuleRouteCachePolicy {
  strategy: 'none' | 'public' | 'private';
  revalidateSeconds: number | null;
  tags: readonly string[];
}

export interface ModuleCacheRevalidationRequest {
  path?: string;
  tag?: string;
  moduleId?: string;
}

export type ModuleCacheRevalidationHandler = (
  request: ModuleCacheRevalidationRequest
) => void | Promise<void>;

export function resolveModuleRouteCachePolicy(
  route: ModulePageRoute | ResolvedModulePageEffectiveRoute
): ModuleRouteCachePolicy {
  return {
    strategy: route.cache?.strategy ?? 'none',
    revalidateSeconds: route.cache?.revalidateSeconds ?? null,
    tags: route.cache?.tags ?? [],
  };
}

export function createModuleCacheRuntime(revalidate: ModuleCacheRevalidationHandler) {
  return {
    revalidatePath(path: string, moduleId?: string) {
      return revalidate({ path, moduleId });
    },
    revalidateTag(tag: string, moduleId?: string) {
      return revalidate({ tag, moduleId });
    },
  };
}
