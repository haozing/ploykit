/**
 * Application Initialization
 *
 * Split into critical and warmup initialization:
 * - Critical: must succeed, failures block startup in production
 * - Warmup: best-effort, failures are logged but do not block startup
 */

import { env } from '@/lib/_core/env';
import { logger } from '@/lib/_core/logger';
import { warmupCaches } from '@/lib/cache';
import { registerCoreJobs } from '@/lib/jobs/core-jobs.server';
import { syncPluginsToDatabase } from '@/lib/plugins/plugin-sync';
import { initializeReliabilityRuntime } from '@/lib/reliability/init.server';
import { initializeStorageRuntime } from '@/lib/services/storage/init.server';
import { initSubscriptionHandlers } from '@/lib/webhooks/handlers/subscription-handler';
import { initializeWebhooks } from '@/lib/webhooks/init';

let isInitialized = false;

export type InitializationOverallStatus = 'idle' | 'initializing' | 'ok' | 'degraded' | 'failed';
export type InitializationStepStatus = 'pending' | 'running' | 'ok' | 'failed';

export interface InitializationErrorInfo {
  step: string;
  message: string;
  name?: string;
  at: string;
}

export interface InitializationStepState {
  status: InitializationStepStatus;
  startedAt?: string;
  completedAt?: string;
  error?: InitializationErrorInfo;
}

export interface InitializationStatus {
  overall: InitializationOverallStatus;
  startedAt?: string;
  completedAt?: string;
  lastError?: InitializationErrorInfo;
  critical: {
    reliability: InitializationStepState;
    storage: InitializationStepState;
    webhook: InitializationStepState;
    subscription: InitializationStepState;
    jobs: InitializationStepState;
  };
  warmups: {
    pluginSync: InitializationStepState;
    cache: InitializationStepState;
  };
}

type CriticalStepKey = keyof InitializationStatus['critical'];
type WarmupStepKey = keyof InitializationStatus['warmups'];

interface InitializationStepDefinition<TKey extends string> {
  key: TKey;
  stepNumber: number;
  label: string;
  run: () => unknown | Promise<unknown>;
}

function createStepState(): InitializationStepState {
  return { status: 'pending' };
}

function createInitialStatus(): InitializationStatus {
  return {
    overall: 'idle',
    critical: {
      reliability: createStepState(),
      storage: createStepState(),
      webhook: createStepState(),
      subscription: createStepState(),
      jobs: createStepState(),
    },
    warmups: {
      pluginSync: createStepState(),
      cache: createStepState(),
    },
  };
}

let initStatus = createInitialStatus();

const CRITICAL_STEPS: Array<InitializationStepDefinition<CriticalStepKey>> = [
  {
    key: 'reliability',
    stepNumber: 1,
    label: 'Reliability runtime',
    run: () => initializeReliabilityRuntime(),
  },
  {
    key: 'storage',
    stepNumber: 2,
    label: 'Storage runtime',
    run: () => initializeStorageRuntime(),
  },
  {
    key: 'webhook',
    stepNumber: 3,
    label: 'Webhook system',
    run: () => initializeWebhooks(),
  },
  {
    key: 'subscription',
    stepNumber: 4,
    label: 'Subscription handlers',
    run: () => initSubscriptionHandlers(),
  },
  {
    key: 'jobs',
    stepNumber: 5,
    label: 'Core job registry',
    run: () => registerCoreJobs(),
  },
];

const WARMUP_STEPS: Array<InitializationStepDefinition<WarmupStepKey>> = [
  {
    key: 'pluginSync',
    stepNumber: 6,
    label: 'Plugin database sync',
    run: () => syncPluginsToDatabase(),
  },
  {
    key: 'cache',
    stepNumber: 7,
    label: 'Cache warmup',
    run: () => warmupCaches(),
  },
];

function toErrorInfo(step: string, error: unknown): InitializationErrorInfo {
  return {
    step,
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : undefined,
    at: new Date().toISOString(),
  };
}

function cloneStepState(step: InitializationStepState): InitializationStepState {
  return {
    status: step.status,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    error: step.error ? { ...step.error } : undefined,
  };
}

function cloneInitializationStatus(status: InitializationStatus): InitializationStatus {
  return {
    overall: status.overall,
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    lastError: status.lastError ? { ...status.lastError } : undefined,
    critical: {
      reliability: cloneStepState(status.critical.reliability),
      storage: cloneStepState(status.critical.storage),
      webhook: cloneStepState(status.critical.webhook),
      subscription: cloneStepState(status.critical.subscription),
      jobs: cloneStepState(status.critical.jobs),
    },
    warmups: {
      pluginSync: cloneStepState(status.warmups.pluginSync),
      cache: cloneStepState(status.warmups.cache),
    },
  };
}

function getStepState<TKey extends CriticalStepKey | WarmupStepKey>(
  group: 'critical' | 'warmups',
  key: TKey
): InitializationStepState {
  return group === 'critical'
    ? initStatus.critical[key as CriticalStepKey]
    : initStatus.warmups[key as WarmupStepKey];
}

async function runStep<TKey extends CriticalStepKey | WarmupStepKey>(
  group: 'critical' | 'warmups',
  definition: InitializationStepDefinition<TKey>
): Promise<void> {
  const stepState = getStepState(group, definition.key);

  if (stepState.status === 'ok') {
    logger.debug(
      { step: definition.key, group },
      `${definition.label} already initialized, skipping`
    );
    return;
  }

  stepState.status = 'running';
  stepState.startedAt = new Date().toISOString();
  stepState.completedAt = undefined;
  stepState.error = undefined;

  logger.info(
    { step: definition.stepNumber, group, key: definition.key },
    `Step ${definition.stepNumber}: Initializing ${definition.label}`
  );

  try {
    await definition.run();

    stepState.status = 'ok';
    stepState.completedAt = new Date().toISOString();

    logger.info(
      { step: definition.stepNumber, group, key: definition.key },
      `${definition.label} initialized`
    );
  } catch (error) {
    const errorInfo = toErrorInfo(definition.key, error);

    stepState.status = 'failed';
    stepState.completedAt = new Date().toISOString();
    stepState.error = errorInfo;
    initStatus.lastError = errorInfo;

    logger.error(
      { error, step: definition.stepNumber, group, key: definition.key },
      `${definition.label} initialization failed`
    );

    throw new Error(`${definition.label} initialization failed`);
  }
}

/**
 * Initialize critical systems.
 *
 * These must succeed. In production, failures throw and block startup.
 */
async function initializeCriticalSystems(): Promise<void> {
  logger.info('Starting critical system initialization');

  for (const step of CRITICAL_STEPS) {
    await runStep('critical', step);
  }

  logger.info('Critical systems initialized');
}

/**
 * Initialize warmup systems.
 *
 * These are best-effort. Failures are logged and reflected as degraded status.
 */
async function initializeWarmups(): Promise<boolean> {
  let hasFailure = false;

  logger.info('Starting warmup initialization');

  for (const step of WARMUP_STEPS) {
    try {
      await runStep('warmups', step);
    } catch {
      hasFailure = true;
    }
  }

  logger.info({ degraded: hasFailure }, 'Warmup initialization completed');
  return hasFailure;
}

/**
 * Initialize all application subsystems.
 *
 * In production, critical initialization failures will throw.
 * In development/test, failures are logged but do not block.
 */
export async function initializeApplication(): Promise<void> {
  if (isInitialized) {
    logger.debug({ status: initStatus.overall }, 'Application already initialized, skipping');
    return;
  }

  initStatus.overall = 'initializing';
  initStatus.startedAt = new Date().toISOString();
  initStatus.completedAt = undefined;
  initStatus.lastError = undefined;

  try {
    await initializeCriticalSystems();
    const warmupFailed = await initializeWarmups();

    isInitialized = true;
    initStatus.overall = warmupFailed ? 'degraded' : 'ok';
    initStatus.completedAt = new Date().toISOString();

    logger.info({ status: initStatus.overall }, 'Application initialization completed');
  } catch (error) {
    initStatus.overall = 'failed';
    initStatus.completedAt = new Date().toISOString();

    logger.error({ error, status: getInitializationStatus() }, 'Application initialization failed');

    // In production, critical failures must block startup.
    if (env.NODE_ENV === 'production') {
      throw error;
    }

    logger.warn('Continuing despite initialization failure (non-production mode)');
  }
}

/**
 * Get structured initialization status.
 */
export function getInitializationStatus(): InitializationStatus {
  return cloneInitializationStatus(initStatus);
}

export function __resetInitializationForTests(): void {
  isInitialized = false;
  initStatus = createInitialStatus();
}
