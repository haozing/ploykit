import type { EventMetadata } from './types';

export type OutboxEntryStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'ignored'
  | 'archived';

export interface OutboxEntry {
  id: string;
  event: string;
  payload: unknown;
  metadata: EventMetadata;
  status: OutboxEntryStatus;
  attempts: number;
  maxAttempts: number;
  error?: string;
  nextAttemptAt?: Date;
  lockedAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
  processedAt?: Date;
}

export interface OutboxStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  ignored: number;
  archived: number;
}

export interface OutboxProcessLease {
  acquired: boolean;
  attempts: number;
}

export interface OutboxStore {
  enqueue(entry: OutboxEntry): Promise<void>;
  listPending(): Promise<OutboxEntry[]>;
  markProcessing(entryId: string, attempts: number, lockedAt: Date): Promise<OutboxProcessLease>;
  markCompleted(entryId: string, processedAt: Date): Promise<void>;
  markRetry(
    entryId: string,
    options: { attempts: number; error: string; nextAttemptAt: Date }
  ): Promise<void>;
  markFailed(entryId: string, options: { attempts: number; error: string }): Promise<void>;
  getStats(): Promise<OutboxStats>;
  getFailedEntries(): Promise<OutboxEntry[]>;
  resetFailed(entryId: string): Promise<boolean>;
  markIgnored(entryId: string, reason?: string): Promise<boolean>;
  markArchived(entryId: string, reason?: string): Promise<boolean>;
  clear(): Promise<void>;
}

function cloneEntry(entry: OutboxEntry): OutboxEntry {
  return {
    ...entry,
    metadata: {
      ...entry.metadata,
      timestamp: new Date(entry.metadata.timestamp),
    },
    createdAt: new Date(entry.createdAt),
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : undefined,
    nextAttemptAt: entry.nextAttemptAt ? new Date(entry.nextAttemptAt) : undefined,
    lockedAt: entry.lockedAt ? new Date(entry.lockedAt) : undefined,
    processedAt: entry.processedAt ? new Date(entry.processedAt) : undefined,
  };
}

export class MemoryOutboxStore implements OutboxStore {
  private entries = new Map<string, OutboxEntry>();

  async enqueue(entry: OutboxEntry): Promise<void> {
    this.entries.set(entry.id, cloneEntry(entry));
  }

  async listPending(): Promise<OutboxEntry[]> {
    const now = Date.now();

    return Array.from(this.entries.values())
      .filter(
        (entry) =>
          entry.status === 'pending' &&
          (!entry.nextAttemptAt || entry.nextAttemptAt.getTime() <= now)
      )
      .map(cloneEntry);
  }

  async markProcessing(
    entryId: string,
    attempts: number,
    lockedAt: Date
  ): Promise<OutboxProcessLease> {
    const entry = this.entries.get(entryId);
    if (!entry || entry.status !== 'pending') {
      return { acquired: false, attempts };
    }

    entry.status = 'processing';
    entry.attempts = attempts;
    entry.lockedAt = lockedAt;
    entry.updatedAt = lockedAt;

    return { acquired: true, attempts };
  }

  async markCompleted(entryId: string, processedAt: Date): Promise<void> {
    const entry = this.entries.get(entryId);
    if (!entry) return;

    entry.status = 'completed';
    entry.processedAt = processedAt;
    entry.updatedAt = processedAt;
    entry.lockedAt = undefined;
  }

  async markRetry(
    entryId: string,
    options: { attempts: number; error: string; nextAttemptAt: Date }
  ): Promise<void> {
    const entry = this.entries.get(entryId);
    if (!entry) return;

    entry.status = 'pending';
    entry.attempts = options.attempts;
    entry.error = options.error;
    entry.nextAttemptAt = options.nextAttemptAt;
    entry.updatedAt = new Date();
    entry.lockedAt = undefined;
  }

  async markFailed(entryId: string, options: { attempts: number; error: string }): Promise<void> {
    const entry = this.entries.get(entryId);
    if (!entry) return;

    entry.status = 'failed';
    entry.attempts = options.attempts;
    entry.error = options.error;
    entry.updatedAt = new Date();
    entry.lockedAt = undefined;
  }

  async getStats(): Promise<OutboxStats> {
    const entries = Array.from(this.entries.values());
    return {
      total: entries.length,
      pending: entries.filter((entry) => entry.status === 'pending').length,
      processing: entries.filter((entry) => entry.status === 'processing').length,
      completed: entries.filter((entry) => entry.status === 'completed').length,
      failed: entries.filter((entry) => entry.status === 'failed').length,
      ignored: entries.filter((entry) => entry.status === 'ignored').length,
      archived: entries.filter((entry) => entry.status === 'archived').length,
    };
  }

  async getFailedEntries(): Promise<OutboxEntry[]> {
    return Array.from(this.entries.values())
      .filter((entry) => entry.status === 'failed')
      .map(cloneEntry);
  }

  async resetFailed(entryId: string): Promise<boolean> {
    const entry = this.entries.get(entryId);
    if (!entry || entry.status !== 'failed') return false;

    const now = new Date();
    entry.status = 'pending';
    entry.attempts = 0;
    entry.error = undefined;
    entry.lockedAt = undefined;
    entry.processedAt = undefined;
    entry.nextAttemptAt = now;
    entry.updatedAt = now;
    return true;
  }

  async markIgnored(entryId: string, reason?: string): Promise<boolean> {
    const entry = this.entries.get(entryId);
    if (!entry || entry.status !== 'failed') return false;

    entry.status = 'ignored';
    entry.error = reason || entry.error;
    entry.updatedAt = new Date();
    entry.lockedAt = undefined;
    return true;
  }

  async markArchived(entryId: string, reason?: string): Promise<boolean> {
    const entry = this.entries.get(entryId);
    if (!entry || entry.status !== 'failed') return false;

    entry.status = 'archived';
    entry.error = reason || entry.error;
    entry.updatedAt = new Date();
    entry.lockedAt = undefined;
    return true;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}
