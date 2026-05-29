import type { ModuleApiRoute } from '@ploykit/module-sdk';

export interface ModuleAnonymousPolicyPlan {
  routePath: string;
  rateLimit: ModuleApiRoute['anonymousPolicy'] extends infer T
    ? T extends { rateLimit?: infer R }
      ? R | null
      : null
    : null;
  allowHighCostActions: boolean;
  maxUploadBytes: number | null;
  captcha: 'never' | 'auto' | 'always';
}

export function createModuleAnonymousPolicyPlan(route: ModuleApiRoute): ModuleAnonymousPolicyPlan {
  return {
    routePath: route.path,
    rateLimit: route.anonymousPolicy?.rateLimit ?? null,
    allowHighCostActions: route.anonymousPolicy?.allowHighCostActions ?? false,
    maxUploadBytes: route.anonymousPolicy?.maxUploadBytes ?? null,
    captcha: route.anonymousPolicy?.captcha ?? 'never',
  };
}
