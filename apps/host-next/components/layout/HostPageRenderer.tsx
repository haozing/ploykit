import type { ReactNode } from 'react';
import type { HostPageCompositionPlan } from '@/lib/module-runtime';

export function HostPageRenderer({
  plan,
  defaultPage,
  overridePage,
  overrideResolved,
}: {
  plan: HostPageCompositionPlan;
  defaultPage: ReactNode;
  overridePage?: ReactNode;
  overrideResolved?: boolean;
}) {
  if (plan.activeOverride && overrideResolved) {
    return <>{overridePage}</>;
  }

  return <>{defaultPage}</>;
}
