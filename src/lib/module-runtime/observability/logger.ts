import { redactSensitive } from './redaction';

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeLogRecord {
  at: string;
  level: RuntimeLogLevel;
  message: string;
  moduleId?: string;
  entry?: string;
  requestId?: string;
  userId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeLogger {
  records: readonly RuntimeLogRecord[];
  log(record: Omit<RuntimeLogRecord, 'at'> & { at?: string }): RuntimeLogRecord;
  debug(message: string, metadata?: Record<string, unknown>): RuntimeLogRecord;
  info(message: string, metadata?: Record<string, unknown>): RuntimeLogRecord;
  warn(message: string, metadata?: Record<string, unknown>): RuntimeLogRecord;
  error(message: string, metadata?: Record<string, unknown>): RuntimeLogRecord;
}

export interface CreateRuntimeLoggerOptions {
  now?: () => Date;
  sink?: (record: RuntimeLogRecord) => void;
}

export function createRuntimeLogger(options: CreateRuntimeLoggerOptions = {}): RuntimeLogger {
  const records: RuntimeLogRecord[] = [];
  const now = options.now ?? (() => new Date());

  function log(record: Omit<RuntimeLogRecord, 'at'> & { at?: string }): RuntimeLogRecord {
    const next: RuntimeLogRecord = {
      ...record,
      at: record.at ?? now().toISOString(),
      metadata: record.metadata ? redactSensitive(record.metadata) : undefined,
    };
    records.push(next);
    options.sink?.(next);
    return next;
  }

  return {
    get records() {
      return records.map((record) => ({
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
      }));
    },
    log,
    debug(message, metadata) {
      return log({ level: 'debug', message, metadata });
    },
    info(message, metadata) {
      return log({ level: 'info', message, metadata });
    },
    warn(message, metadata) {
      return log({ level: 'warn', message, metadata });
    },
    error(message, metadata) {
      return log({ level: 'error', message, metadata });
    },
  };
}
