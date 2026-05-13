import { env } from '@/lib/_core/env';
import { logger } from '@/lib/_core/logger';
import { eventBus } from '@/lib/bus/event-bus';
import { DatabaseOutboxStore } from '@/lib/bus/transports/outbox-store.server';
import { DatabaseAuditPort, describeAuditPort, setAuditPort } from '@/lib/audit/audit-port.server';
import {
  DatabaseUsageLedger,
  describeUsageLedger,
  setUsageLedger,
} from '@/lib/usage/usage-ledger.server';

export interface ReliabilityRuntimeStatus {
  initialized: boolean;
  databaseConfigured: boolean;
  outboxStore: 'database' | 'memory';
  outboxProcessorStarted: boolean;
  audit: ReturnType<typeof describeAuditPort>;
  usage: ReturnType<typeof describeUsageLedger>;
  initializedAt?: string;
}

let initialized = false;
let initializedAt: Date | undefined;
let outboxStore: 'database' | 'memory' = 'memory';
let outboxProcessorStarted = false;

export function hasReliabilityDatabaseConfig(): boolean {
  const hasConnectionParams = Boolean(
    env.POSTGRES_HOST && env.POSTGRES_DB && env.POSTGRES_USER && env.POSTGRES_PASSWORD
  );

  return (
    env.NEXT_PHASE !== 'phase-production-build' &&
    Boolean(env.DATABASE_URL || env.NEON_DATABASE_URL || hasConnectionParams)
  );
}

export function initializeReliabilityRuntime(): ReliabilityRuntimeStatus {
  if (initialized) {
    return getReliabilityRuntimeStatus();
  }

  const databaseConfigured = hasReliabilityDatabaseConfig();

  if (databaseConfigured) {
    eventBus.configureOutboxStore(new DatabaseOutboxStore());
    setAuditPort(new DatabaseAuditPort());
    setUsageLedger(new DatabaseUsageLedger());
    outboxStore = 'database';
  } else {
    logger.warn(
      'Reliability runtime is using memory-backed outbox/audit/usage adapters because no database configuration was found'
    );
    outboxStore = 'memory';
  }

  eventBus.startOutboxProcessor();
  outboxProcessorStarted = true;
  initialized = true;
  initializedAt = new Date();

  logger.info(
    {
      databaseConfigured,
      outboxStore,
      audit: describeAuditPort(),
      usage: describeUsageLedger(),
    },
    'Reliability runtime initialized'
  );

  return getReliabilityRuntimeStatus();
}

export function getReliabilityRuntimeStatus(): ReliabilityRuntimeStatus {
  return {
    initialized,
    databaseConfigured: hasReliabilityDatabaseConfig(),
    outboxStore,
    outboxProcessorStarted,
    audit: describeAuditPort(),
    usage: describeUsageLedger(),
    initializedAt: initializedAt?.toISOString(),
  };
}
