import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import { validateActions } from './validator-actions';
import { validateCleanContract } from './validator-clean-contract';
import { validateJobsEventsWebhooks } from './validator-background';
import { validateData } from './validator-data';
import { validateI18n, validateResources } from './validator-resources';
import { validateCapabilityMetadata } from './validator-runtime-metadata';
import { validateSurfaces } from './validator-surfaces';
import { ModulePermissionValues, type PermissionValue } from './permissions';
import type { ModuleCapability, ModuleDefinition, ModuleProfile } from './types';
import { validateNavigation } from './validator-product';

const MODULE_ID_PATTERN = /^[a-z0-9-]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const PROFILES = new Set<ModuleProfile>(['app', 'ai-tool', 'digital-commerce', 'cms']);
const CAPABILITIES = new Set<ModuleCapability>([
  'files',
  'async',
  'events',
  'notifications',
  'ai',
  'rag',
  'services',
  'commercial',
]);

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'error', message, path, fix }));
}

function validatePermissionList(
  diagnostics: ModuleDiagnostic[],
  permissions: readonly string[] | undefined,
  path: string
): void {
  for (const [index, permission] of (permissions ?? []).entries()) {
    if (!ModulePermissionValues.has(permission as PermissionValue)) {
      addError(
        diagnostics,
        'MODULE_PERMISSION_UNKNOWN',
        `Permission "${permission}" is not part of @ploykit/module-sdk.`,
        `${path}.${index}`
      );
    }
  }
}

function validateProfileAndCapabilities(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  if (!PROFILES.has(definition.profile)) {
    addError(
      diagnostics,
      'MODULE_PROFILE_INVALID',
      `Module profile "${String(definition.profile)}" is not supported.`,
      'profile',
      'Use app, ai-tool, digital-commerce, or cms.'
    );
  }
  for (const [index, capability] of (definition.capabilities ?? []).entries()) {
    if (!CAPABILITIES.has(capability)) {
      addError(
        diagnostics,
        'MODULE_CAPABILITY_INVALID',
        `Capability "${String(capability)}" is not a formal capability pack.`,
        `capabilities.${index}`
      );
    }
  }
  if (definition.profile === 'ai-tool' && !definition.capabilities?.includes('ai')) {
    addError(
      diagnostics,
      'MODULE_PROFILE_CAPABILITY_MISSING',
      'ai-tool modules must enable the ai capability pack.',
      'capabilities',
      'Add "ai" to capabilities.'
    );
  }
  if (definition.profile === 'digital-commerce' && !definition.capabilities?.includes('commercial')) {
    addError(
      diagnostics,
      'MODULE_PROFILE_CAPABILITY_MISSING',
      'digital-commerce modules must enable the commercial capability pack.',
      'capabilities',
      'Add "commercial" to capabilities.'
    );
  }
}

export function validateModuleDefinition(definition: ModuleDefinition): ModuleDiagnostic[] {
  const diagnostics: ModuleDiagnostic[] = [];

  if (!MODULE_ID_PATTERN.test(definition.id)) {
    addError(
      diagnostics,
      'MODULE_ID_INVALID',
      `Module id "${definition.id}" must contain only lowercase letters, numbers, and hyphens.`,
      'id'
    );
  }
  if (!definition.name.trim()) {
    addError(diagnostics, 'MODULE_NAME_REQUIRED', 'Module name is required.', 'name');
  }
  if (!SEMVER_PATTERN.test(definition.version)) {
    addError(
      diagnostics,
      'MODULE_VERSION_INVALID',
      `Module version "${definition.version}" must follow semantic versioning.`,
      'version'
    );
  }

  validateProfileAndCapabilities(diagnostics, definition);
  validatePermissionList(diagnostics, definition.permissions, 'permissions');
  validateData(diagnostics, definition.data);
  validateActions(diagnostics, definition);
  validateSurfaces(diagnostics, definition);
  validateNavigation(diagnostics, definition);
  validateResources(diagnostics, definition);
  validateI18n(diagnostics, definition);
  validateJobsEventsWebhooks(diagnostics, definition);
  validateCapabilityMetadata(diagnostics, definition);
  validateCleanContract(diagnostics, definition);

  return diagnostics;
}
