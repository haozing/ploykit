import type { ModuleCreditsApi, ModuleMeteringApi } from '@ploykit/module-sdk';

export interface AiCostGuardPolicy {
  meter: string;
  credits: number;
  unit?: string;
}

export async function runWithAiCostGuard<TResult>(input: {
  userId: string;
  metering: ModuleMeteringApi;
  credits: ModuleCreditsApi;
  policy: AiCostGuardPolicy;
  idempotencyKey?: string;
  usage?: (result: TResult) => {
    quantity?: number;
    unit?: string;
    metadata?: Record<string, unknown>;
  };
  run: () => Promise<TResult>;
}): Promise<TResult> {
  const subject = { type: 'user' as const, id: input.userId };
  const reservation =
    input.policy.credits > 0
      ? await input.credits.reserve({
          subject,
          amount: input.policy.credits,
          unit: input.policy.unit,
          reason: 'ai.cost.reserve',
          source: 'ai',
          sourceId: input.policy.meter,
          idempotencyKey: input.idempotencyKey ? `reserve:${input.idempotencyKey}` : undefined,
        })
      : null;
  try {
    const result = await input.run();
    const usage = input.usage?.(result) ?? {};
    await input.metering.charge({
      subject,
      meter: input.policy.meter,
      quantity: usage.quantity ?? 1,
      unit: usage.unit,
      credits:
        input.policy.credits > 0
          ? { amount: input.policy.credits, unit: input.policy.unit }
          : undefined,
      reservationId: reservation?.id,
      idempotencyKey: input.idempotencyKey ? `charge:${input.idempotencyKey}` : undefined,
      metadata: usage.metadata,
    });
    return result;
  } catch (error) {
    if (reservation) {
      await input.credits.releaseReservation({
        reservationId: reservation.id,
        reason: 'ai.cost.release',
        idempotencyKey: input.idempotencyKey ? `release:${input.idempotencyKey}` : undefined,
      });
    }
    throw error;
  }
}
