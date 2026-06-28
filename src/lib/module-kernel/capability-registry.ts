import { SystemOnlyPermissions, type PermissionValue } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../module-runtime/contract';
import type { ModuleRuntimeAccessSession } from '../module-runtime/security';

export interface CapabilityMountInput {
  contract: ModuleRuntimeContract;
  request: Request;
  params: Record<string, string>;
  session: ModuleRuntimeAccessSession;
}

export interface CapabilityGuardInput<TApi> {
  api: TApi;
  contract: ModuleRuntimeContract;
  session: ModuleRuntimeAccessSession;
}

export interface CapabilityDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

export interface CapabilityDescriptor<TName extends string = string, TApi = unknown> {
  name: TName;
  ctxKey: TName;
  permissions: readonly PermissionValue[];
  mount?(input: CapabilityMountInput): TApi | undefined;
  guard?(input: CapabilityGuardInput<TApi>): TApi;
  doctor?(input: { moduleRoot: string }): CapabilityDiagnostic[];
  validateContract?(input: { contract: ModuleRuntimeContract }): CapabilityDiagnostic[];
}

export class CapabilityDescriptorRegistry {
  private readonly descriptors = new Map<string, CapabilityDescriptor>();
  private readonly ctxKeys = new Map<string, string>();

  register<TName extends string, TApi>(
    descriptor: CapabilityDescriptor<TName, TApi>
  ): CapabilityDescriptorRegistry {
    if (this.descriptors.has(descriptor.name)) {
      throw new Error(`MODULE_CAPABILITY_DESCRIPTOR_DUPLICATE: ${descriptor.name}`);
    }
    const existingCtxKey = this.ctxKeys.get(descriptor.ctxKey);
    if (existingCtxKey) {
      throw new Error(
        `MODULE_CAPABILITY_CTXKEY_DUPLICATE: ctx.extensions.${descriptor.ctxKey} is already provided by "${existingCtxKey}".`
      );
    }
    this.descriptors.set(descriptor.name, descriptor as CapabilityDescriptor);
    this.ctxKeys.set(descriptor.ctxKey, descriptor.name);
    return this;
  }

  get(name: string): CapabilityDescriptor | undefined {
    return this.descriptors.get(name);
  }

  list(): CapabilityDescriptor[] {
    return [...this.descriptors.values()];
  }
}

export function createCapabilityDescriptorRegistry(): CapabilityDescriptorRegistry {
  return new CapabilityDescriptorRegistry();
}

export type CapabilityProvider =
  | unknown
  | ((input: CapabilityMountInput) => unknown);

export type CapabilityProviderRegistry = Readonly<Record<string, CapabilityProvider | undefined>>;

function hasSessionPermission(
  session: ModuleRuntimeAccessSession,
  permission: PermissionValue
): boolean {
  if (session.system || session.user?.role === 'admin') {
    return true;
  }
  return Array.isArray(session.permissions) && session.permissions.includes(permission);
}

function assertDescriptorPermissions(
  descriptor: CapabilityDescriptor,
  contract: ModuleRuntimeContract,
  session: ModuleRuntimeAccessSession
): void {
  for (const permission of descriptor.permissions) {
    if (SystemOnlyPermissions.has(permission) && !session.system) {
      throw new Error(
        `MODULE_CAPABILITY_SYSTEM_PERMISSION_REQUIRED: ctx.extensions.${descriptor.ctxKey} requires system-only permission "${permission}".`
      );
    }
    if (!contract.permissions.includes(permission)) {
      throw new Error(
        `MODULE_CAPABILITY_PERMISSION_NOT_DECLARED: ctx.extensions.${descriptor.ctxKey} requires module permission "${permission}".`
      );
    }
    if (!hasSessionPermission(session, permission)) {
      throw new Error(
        `MODULE_CAPABILITY_PERMISSION_DENIED: ctx.extensions.${descriptor.ctxKey} requires session permission "${permission}".`
      );
    }
  }
}

export function mountCapabilityDescriptors(input: {
  descriptors: CapabilityDescriptorRegistry;
  providers?: CapabilityProviderRegistry;
  mountInput: CapabilityMountInput;
  allowedNames?: readonly string[];
}): Record<string, unknown> {
  const mounted: Record<string, unknown> = {};
  const allowedNames = input.allowedNames ? new Set(input.allowedNames) : undefined;
  for (const descriptor of input.descriptors.list()) {
    if (allowedNames && !allowedNames.has(descriptor.name) && !allowedNames.has(descriptor.ctxKey)) {
      continue;
    }
    const provider = input.providers?.[descriptor.name] ?? input.providers?.[descriptor.ctxKey];
    const api =
      descriptor.mount?.(input.mountInput) ??
      (typeof provider === 'function'
        ? (provider as (mountInput: CapabilityMountInput) => unknown)(input.mountInput)
        : provider);
    if (api === undefined) {
      continue;
    }
    assertDescriptorPermissions(descriptor, input.mountInput.contract, input.mountInput.session);
    mounted[descriptor.ctxKey] = descriptor.guard
      ? descriptor.guard({
          api,
          contract: input.mountInput.contract,
          session: input.mountInput.session,
        })
      : api;
  }
  return mounted;
}
