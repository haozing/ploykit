import 'server-only';

import { eventBus } from './event-bus';
import type { OutboxEntry, OutboxStats } from './transports/outbox-store';

export interface DeadLetterSummary {
  id: string;
  event: string;
  emitterId: string;
  attempts: number;
  maxAttempts: number;
  error?: string;
  createdAt: string;
  updatedAt?: string;
  nextAttemptAt?: string;
}

function toDeadLetterSummary(entry: OutboxEntry): DeadLetterSummary {
  return {
    id: entry.id,
    event: entry.event,
    emitterId: entry.metadata.emitterId,
    attempts: entry.attempts,
    maxAttempts: entry.maxAttempts,
    error: entry.error,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt?.toISOString(),
    nextAttemptAt: entry.nextAttemptAt?.toISOString(),
  };
}

export async function listOutboxDeadLetters(): Promise<{
  stats: OutboxStats;
  entries: DeadLetterSummary[];
}> {
  const [stats, failedEntries] = await Promise.all([
    eventBus.getOutboxStats(),
    eventBus.getFailedOutboxEntries(),
  ]);

  return {
    stats,
    entries: failedEntries.map(toDeadLetterSummary),
  };
}

export async function replayOutboxDeadLetter(entryId: string): Promise<{
  replayed: boolean;
  stats: OutboxStats;
}> {
  const replayed = await eventBus.replayOutboxEntry(entryId);
  const stats = await eventBus.getOutboxStats();

  return {
    replayed,
    stats,
  };
}

export type OutboxDeadLetterAction = 'replay' | 'ignore' | 'archive';

export async function handleOutboxDeadLetter(
  entryId: string,
  action: OutboxDeadLetterAction,
  reason?: string
): Promise<{
  handled: boolean;
  action: OutboxDeadLetterAction;
  stats: OutboxStats;
}> {
  const handled =
    action === 'replay'
      ? await eventBus.replayOutboxEntry(entryId)
      : action === 'ignore'
        ? await eventBus.ignoreOutboxEntry(entryId, reason)
        : await eventBus.archiveOutboxEntry(entryId, reason);

  const stats = await eventBus.getOutboxStats();

  return {
    handled,
    action,
    stats,
  };
}

export async function handleOutboxDeadLettersBulk(
  entryIds: string[],
  action: OutboxDeadLetterAction,
  reason?: string
): Promise<{
  action: OutboxDeadLetterAction;
  handled: number;
  skipped: number;
  stats: OutboxStats;
}> {
  let handled = 0;

  for (const entryId of entryIds) {
    const result = await handleOutboxDeadLetter(entryId, action, reason);
    if (result.handled) {
      handled += 1;
    }
  }

  const stats = await eventBus.getOutboxStats();

  return {
    action,
    handled,
    skipped: entryIds.length - handled,
    stats,
  };
}
