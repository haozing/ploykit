import 'server-only';

import { ValidationError } from '@/lib/_core/errors';
import { DEFAULT_PRODUCT_ID, listRuntimeProducts } from '@/lib/plugin-runtime/loader';
import {
  type PlanCapabilityDefinition,
  type PlanCapabilityValidationIssue,
  validatePlanCapabilityValueSet,
} from './plan-capability-types';

const BUILT_IN_PLAN_CAPABILITIES: readonly PlanCapabilityDefinition[] = [];

function issueMessage(issue: PlanCapabilityValidationIssue): string {
  switch (issue.code) {
    case 'required':
      return `${issue.key} is required`;
    case 'invalidBoolean':
      return `${issue.key} must be true or false`;
    case 'invalidNumber':
      return `${issue.key} must be a finite number`;
    case 'invalidString':
      return `${issue.key} must be a string`;
    case 'invalidOption':
      return `${issue.key} must be one of its declared options`;
    case 'missingOptions':
      return `${issue.key} has no declared options`;
  }
}

function sortDefinitions(
  definitions: readonly PlanCapabilityDefinition[]
): PlanCapabilityDefinition[] {
  return [...definitions].sort((left, right) => {
    const orderDelta = left.sortOrder - right.sortOrder;
    return orderDelta !== 0 ? orderDelta : left.key.localeCompare(right.key);
  });
}

function assertUniqueCapabilityKeys(definitions: readonly PlanCapabilityDefinition[]): void {
  const ownersByKey = new Map<string, string>();
  for (const definition of definitions) {
    const owner = `${definition.ownerType}:${definition.ownerId}`;
    const existingOwner = ownersByKey.get(definition.key);
    if (existingOwner && existingOwner !== owner) {
      throw new Error(
        `Plan capability "${definition.key}" is declared by both ${existingOwner} and ${owner}.`
      );
    }
    ownersByKey.set(definition.key, owner);
  }
}

export function listPlanCapabilityDefinitions(
  options: { productId?: string } = {}
): PlanCapabilityDefinition[] {
  const productId = options.productId ?? DEFAULT_PRODUCT_ID;
  const productDefinitions = listRuntimeProducts()
    .filter((product) => product.id === productId)
    .flatMap((product) => product.planCapabilities ?? []);
  const definitions = [...BUILT_IN_PLAN_CAPABILITIES, ...productDefinitions];

  assertUniqueCapabilityKeys(definitions);
  return sortDefinitions(definitions);
}

export function normalizePlanFeaturesForStorage(
  features: Record<string, unknown>,
  options: { productId?: string } = {}
): Record<string, boolean | string | number> {
  const definitions = listPlanCapabilityDefinitions(options);
  const featuresWithDefaults = { ...features };

  for (const definition of definitions) {
    if (
      definition.defaultValue !== undefined &&
      !Object.prototype.hasOwnProperty.call(featuresWithDefaults, definition.key)
    ) {
      featuresWithDefaults[definition.key] = definition.defaultValue;
    }
  }

  const validation = validatePlanCapabilityValueSet(definitions, featuresWithDefaults, {
    requireAll: true,
  });

  if (!validation.success) {
    throw new ValidationError('Plan capabilities failed schema validation', {
      issues: validation.issues.map((issue) => ({
        key: issue.key,
        code: issue.code,
        message: issueMessage(issue),
      })),
    });
  }

  const normalizedFeatures: Record<string, boolean | string | number> = {};
  for (const [key, value] of Object.entries(features)) {
    if (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
      normalizedFeatures[key] = value;
    }
  }

  for (const definition of definitions) {
    delete normalizedFeatures[definition.key];
  }

  return {
    ...normalizedFeatures,
    ...validation.values,
  };
}
