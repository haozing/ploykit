import { apiError, apiOk, readJsonObject, requireApiSession, stringBody } from '@host/lib/api';
import {
  bulkArchiveAdminOutbox,
  bulkDiscardAdminOutbox,
  bulkReplayAdminDeadLetters,
  previewAdminOutboxBulkAction,
} from '@host/lib/admin-delivery';
import { listAdminDeadLetters, readAdminApiQuery } from '@host/lib/admin-api';

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  );
  return values.length > 0 ? values : undefined;
}

function readLimit(value: unknown): number | undefined {
  const limit = Number(value);
  return Number.isFinite(limit) ? limit : undefined;
}

function readDryRun(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.outbox.deadLetters.read', {
    admin: true,
  });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk(await listAdminDeadLetters(readAdminApiQuery(request)));
}

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'admin.outbox.deadLetters.write', {
    admin: true,
  });
  if (resolved instanceof Response) {
    return resolved;
  }

  const body = await readJsonObject(request);
  const action = stringBody(body, 'action') ?? 'replay';
  const dryRun = readDryRun(body.dryRun);
  const input = {
    outboxIds: readStringArray(body.outboxIds),
    namePrefix: stringBody(body, 'namePrefix', { maxLength: 128 }),
    limit: readLimit(body.limit),
  };
  const deadLetterInput = {
    ...input,
    status: 'dead_letter' as const,
  };

  if (dryRun && (action === 'replay' || action === 'discard' || action === 'archive')) {
    const preview = await previewAdminOutboxBulkAction(resolved.session, {
      action,
      ...deadLetterInput,
    });
    return apiOk({ ...preview });
  }

  if (action === 'replay') {
    return apiOk(
      await bulkReplayAdminDeadLetters(resolved.session, {
        ...input,
        reason: stringBody(body, 'reason', { maxLength: 200 }) ?? 'Replayed from Admin API',
      })
    );
  }
  if (action === 'discard') {
    return apiOk(
      await bulkDiscardAdminOutbox(resolved.session, {
        ...deadLetterInput,
        reason: stringBody(body, 'reason', { maxLength: 200 }) ?? 'Discarded from Admin API',
      })
    );
  }
  if (action === 'archive') {
    return apiOk(
      await bulkArchiveAdminOutbox(resolved.session, {
        ...deadLetterInput,
        reason: stringBody(body, 'reason', { maxLength: 200 }) ?? 'Archived from Admin API',
      })
    );
  }

  return apiError(400, 'ADMIN_OUTBOX_ACTION_INVALID', `Unsupported action: ${action}`);
}
