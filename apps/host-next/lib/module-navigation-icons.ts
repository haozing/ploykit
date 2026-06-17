import { isModuleIconKey, type ModuleIconKey } from '@/lib/generated/module-icons';

export function resolveModuleNavigationIconKey(
  moduleId: string,
  icon: string | undefined
): ModuleIconKey | undefined {
  if (!icon) {
    return undefined;
  }
  const moduleIcon = `${moduleId}:${icon}`;
  if (isModuleIconKey(moduleIcon)) {
    return moduleIcon;
  }
  if (isModuleIconKey(icon)) {
    return icon;
  }
  return undefined;
}
