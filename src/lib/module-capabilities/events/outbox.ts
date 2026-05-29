import { randomUUID } from 'node:crypto';

export type ModuleEventOutboxStatus = 'queued' | 'processing' | 'processed' | 'failed';

export interface ModuleEventMetadata {
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  sourceModuleId?: string;
}

export interface ModuleEventEnvelope<TPayload = unknown> {
  id: string;
  name: string;
  payload: TPayload;
  metadata: ModuleEventMetadata;
  status: ModuleEventOutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface EnqueueModuleEventInput<TPayload = unknown> {
  name: string;
  payload: TPayload;
  metadata?: ModuleEventMetadata;
}

export interface ListModuleEventsQuery {
  name?: string;
  status?: ModuleEventOutboxStatus;
  sourceModuleId?: string;
  idempotencyKey?: string;
}

export interface ModuleEventOutbox {
  enqueue<TPayload = unknown>(
    input: EnqueueModuleEventInput<TPayload>
  ): ModuleEventEnvelope<TPayload>;
  list(query?: ListModuleEventsQuery): ModuleEventEnvelope[];
  claimBatch(limit?: number): ModuleEventEnvelope[];
  markProcessed(id: string): ModuleEventEnvelope;
  markFailed(id: string, error: Error | string): ModuleEventEnvelope;
}

export interface CreateInMemoryModuleEventOutboxOptions {
  now?: () => Date;
  createId?: () => string;
}

function cloneEvent<TPayload = unknown>(
  event: ModuleEventEnvelope<TPayload>
): ModuleEventEnvelope<TPayload> {
  return {
    ...event,
    metadata: { ...event.metadata },
    error: event.error ? { ...event.error } : undefined,
  };
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function errorMessage(error: Error | string): { code: string; message: string } {
  if (typeof error === 'string') {
    return { code: 'MODULE_EVENT_FAILED', message: error };
  }
  return { code: error.name || 'MODULE_EVENT_FAILED', message: error.message };
}

export function createInMemoryModuleEventOutbox(
  options: CreateInMemoryModuleEventOutboxOptions = {}
): ModuleEventOutbox {
  const events = new Map<string, ModuleEventEnvelope>();
  const idempotencyIndex = new Map<string, string>();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => `evt_${randomUUID()}`);

  function read(id: string): ModuleEventEnvelope {
    const event = events.get(id);
    if (!event) {
      throw new Error(`MODULE_EVENT_NOT_FOUND: ${id}`);
    }
    return event;
  }

  function save(event: ModuleEventEnvelope): ModuleEventEnvelope {
    events.set(event.id, event);
    return cloneEvent(event);
  }

  return {
    enqueue<TPayload = unknown>(input: EnqueueModuleEventInput<TPayload>) {
      const idempotencyKey = input.metadata?.idempotencyKey;
      if (idempotencyKey) {
        const existingId = idempotencyIndex.get(idempotencyKey);
        if (existingId) {
          return cloneEvent(read(existingId)) as ModuleEventEnvelope<TPayload>;
        }
      }

      const timestamp = toIso(now);
      const event: ModuleEventEnvelope<TPayload> = {
        id: createId(),
        name: input.name,
        payload: input.payload,
        metadata: input.metadata ?? {},
        status: 'queued',
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      events.set(event.id, event);
      if (idempotencyKey) {
        idempotencyIndex.set(idempotencyKey, event.id);
      }
      return cloneEvent(event);
    },
    list(query = {}) {
      return [...events.values()]
        .filter((event) => !query.name || event.name === query.name)
        .filter((event) => !query.status || event.status === query.status)
        .filter(
          (event) => !query.sourceModuleId || event.metadata.sourceModuleId === query.sourceModuleId
        )
        .filter(
          (event) => !query.idempotencyKey || event.metadata.idempotencyKey === query.idempotencyKey
        )
        .map((event) => cloneEvent(event));
    },
    claimBatch(limit = 50) {
      const batch = [...events.values()]
        .filter((event) => event.status === 'queued' || event.status === 'failed')
        .slice(0, limit);
      return batch.map((event) =>
        save({
          ...event,
          status: 'processing',
          attempts: event.attempts + 1,
          updatedAt: toIso(now),
        })
      );
    },
    markProcessed(id) {
      const event = read(id);
      const timestamp = toIso(now);
      return save({
        ...event,
        status: 'processed',
        processedAt: timestamp,
        updatedAt: timestamp,
        error: undefined,
      });
    },
    markFailed(id, error) {
      const event = read(id);
      return save({
        ...event,
        status: 'failed',
        error: errorMessage(error),
        updatedAt: toIso(now),
      });
    },
  };
}
