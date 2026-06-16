import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';
import { createRuntimeStoreCommercialRuntime } from '../src/lib/module-capabilities';

test('P16 commercial primitives are subject-first, idempotent and lifecycle aware', async () => {
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T10:00:00.000Z'),
    createId: (prefix) => `${prefix}_primitive_${++nextId}`,
  });
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-primitives',
    workspaceId: 'workspace-primitives',
    planCatalog: [{ id: 'team', name: 'Team', entitlements: ['team.access'] }],
    skuCatalog: {
      team_pack: {
        credits: { amount: 25, unit: 'ai-credit' },
        planId: 'team',
      },
    },
  });
  const moduleCommercial = commercial.forModule('primitive-tool');
  const workspaceSubject = { type: 'workspace' as const, id: 'workspace-wallet' };
  const userSubject = { type: 'user' as const, id: 'user-wallet' };

  await moduleCommercial.credits.grant({
    subject: workspaceSubject,
    amount: 10,
    unit: 'ai-credit',
    source: 'manual',
    sourceId: 'grant-1',
    idempotencyKey: 'grant-workspace',
  });
  await moduleCommercial.credits.grant({
    subject: workspaceSubject,
    amount: 10,
    unit: 'ai-credit',
    source: 'manual',
    sourceId: 'grant-1',
    idempotencyKey: 'grant-workspace',
  });
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    10
  );

  const reservation = await moduleCommercial.credits.reserve({
    subject: workspaceSubject,
    amount: 4,
    unit: 'ai-credit',
    reason: 'ai.reserve',
    source: 'task',
    sourceId: 'task-1',
    idempotencyKey: 'reserve-task-1',
  });
  assert.equal(reservation.status, 'reserved');
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    6
  );
  assert.equal(
    (
      await moduleCommercial.credits.commitReservation({
        reservationId: reservation.id,
        finalAmount: 3,
        idempotencyKey: 'commit-task-1',
      })
    ).balance,
    7
  );
  assert.equal(
    (
      await moduleCommercial.credits.releaseReservation({
        reservationId: reservation.id,
        reason: 'late.provider.failed',
        idempotencyKey: 'release-after-commit-task-1',
      })
    ).balance,
    7
  );
  assert.equal((await store.getCreditReservation(reservation.id))?.status, 'committed');
  const invalidReservation = await moduleCommercial.credits.reserve({
    subject: workspaceSubject,
    amount: 1,
    unit: 'ai-credit',
    source: 'task',
    sourceId: 'task-invalid',
    idempotencyKey: 'reserve-task-invalid',
  });
  await assert.rejects(
    () =>
      moduleCommercial.credits.commitReservation({
        reservationId: invalidReservation.id,
        finalAmount: -1,
      }),
    /MODULE_COMMERCIAL_INVALID_AMOUNT/
  );
  assert.equal(
    (
      await moduleCommercial.credits.releaseReservation({
        reservationId: invalidReservation.id,
        idempotencyKey: 'release-task-invalid',
      })
    ).balance,
    7
  );
  assert.equal(
    (
      await moduleCommercial.credits.listLedger({
        subject: workspaceSubject,
        unit: 'ai-credit',
      })
    ).find(
      (entry) => entry.reservationId === invalidReservation.id && entry.reason === 'reserve.release'
    )?.direction,
    'release'
  );
  assert.equal(
    (
      await moduleCommercial.credits.commitReservation({
        reservationId: reservation.id,
        finalAmount: 3,
        idempotencyKey: 'commit-task-1',
      })
    ).balance,
    7
  );

  const secondReservation = await moduleCommercial.credits.reserve({
    subject: workspaceSubject,
    amount: 2,
    unit: 'ai-credit',
    source: 'task',
    sourceId: 'task-2',
    idempotencyKey: 'reserve-task-2',
  });
  assert.equal(
    (
      await moduleCommercial.credits.releaseReservation({
        reservationId: secondReservation.id,
        reason: 'provider.failed',
        idempotencyKey: 'release-task-2',
      })
    ).balance,
    7
  );
  assert.equal(
    (
      await moduleCommercial.credits.releaseReservation({
        reservationId: secondReservation.id,
        reason: 'provider.failed',
        idempotencyKey: 'release-task-2',
      })
    ).balance,
    7
  );

  const charge = await moduleCommercial.metering.charge({
    subject: workspaceSubject,
    meter: 'ai.generate',
    quantity: 1200,
    unit: 'token',
    credits: { amount: 2, unit: 'ai-credit' },
    idempotencyKey: 'charge-1',
    metadata: {
      provider: 'openai',
      model: 'gpt-4.1',
    },
  });
  const replayedCharge = await moduleCommercial.metering.charge({
    subject: workspaceSubject,
    meter: 'ai.generate',
    quantity: 1200,
    unit: 'token',
    credits: { amount: 2, unit: 'ai-credit' },
    idempotencyKey: 'charge-1',
    metadata: {
      provider: 'openai',
      model: 'gpt-4.1',
    },
  });
  assert.equal(replayedCharge.id, charge.id);
  assert.equal(replayedCharge.usageId, charge.usageId);
  assert.equal(replayedCharge.meteringId, charge.meteringId);
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    5
  );

  await assert.rejects(
    () =>
      moduleCommercial.metering.charge({
        subject: workspaceSubject,
        meter: 'ai.generate',
        credits: { amount: 99, unit: 'ai-credit' },
        idempotencyKey: 'charge-too-large',
      }),
    /MODULE_CREDITS_INSUFFICIENT/
  );
  await assert.rejects(
    () =>
      moduleCommercial.metering.charge({
        subject: workspaceSubject,
        meter: 'ai.generate',
        credits: { amount: -1, unit: 'ai-credit' },
        idempotencyKey: 'charge-negative',
      }),
    /MODULE_COMMERCIAL_INVALID_AMOUNT/
  );
  assert.equal(
    (
      await store.listUsage({
        productId: 'product-primitives',
        moduleId: 'primitive-tool',
      })
    ).filter((record) => record.idempotencyKey?.startsWith('charge-too-large')).length,
    0
  );
  const overageReservation = await moduleCommercial.credits.reserve({
    subject: workspaceSubject,
    amount: 1,
    unit: 'ai-credit',
    source: 'task',
    sourceId: 'task-overage',
    idempotencyKey: 'reserve-task-overage',
  });
  await assert.rejects(
    () =>
      moduleCommercial.metering.charge({
        subject: workspaceSubject,
        meter: 'ai.generate',
        credits: { amount: 99, unit: 'ai-credit' },
        reservationId: overageReservation.id,
        idempotencyKey: 'charge-reservation-overage',
      }),
    /MODULE_CREDITS_INSUFFICIENT/
  );
  assert.equal(
    (
      await store.listMetering({
        productId: 'product-primitives',
        moduleId: 'primitive-tool',
      })
    ).find((record) => record.idempotencyKey === 'charge-reservation-overage:metering')?.status,
    'voided'
  );
  await moduleCommercial.credits.releaseReservation({
    reservationId: overageReservation.id,
    idempotencyKey: 'release-task-overage',
  });

  const entitlement = await moduleCommercial.entitlements.grant({
    subject: userSubject,
    entitlement: 'feature.pro',
    source: 'manual',
    sourceId: 'grant-entitlement-1',
    idempotencyKey: 'grant-entitlement-1',
  });
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: userSubject,
      entitlement: 'feature.pro',
    }),
    true
  );
  assert.equal((await moduleCommercial.entitlements.list({ subject: userSubject })).length, 1);
  await moduleCommercial.entitlements.revoke({
    id: entitlement.id,
    reason: 'manual.revoke',
    idempotencyKey: 'revoke-entitlement-1',
  });
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: userSubject,
      entitlement: 'feature.pro',
    }),
    false
  );

  const checkout = await moduleCommercial.commerce.createCheckout({
    buyer: userSubject,
    beneficiary: workspaceSubject,
    sku: 'team_pack',
    amount: 2500,
    currency: 'usd',
    idempotencyKey: 'checkout-workspace',
  });
  const paid = await moduleCommercial.commerce.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-primitive-paid',
    orderId: checkout.id,
    buyer: userSubject,
    beneficiary: workspaceSubject,
    sku: 'team_pack',
    amount: 2500,
    currency: 'usd',
    idempotencyKey: 'evt-primitive-paid',
  });
  assert.equal(paid.order.beneficiary?.type, 'workspace');
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    30
  );
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: workspaceSubject,
      entitlement: 'team.access',
    }),
    true
  );
  const refunded = await moduleCommercial.commerce.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-primitive-refund',
    orderId: checkout.id,
    amount: 2500,
    currency: 'usd',
    idempotencyKey: 'evt-primitive-refund',
  });
  assert.equal(refunded.order.status, 'refunded');
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: workspaceSubject,
      entitlement: 'team.access',
    }),
    false
  );
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    5
  );

  const batch = await moduleCommercial.redeemCodes.createBatch({
    count: 2,
    prefix: 'TEAM',
    entitlement: 'redeem.access',
    credits: { amount: 3, unit: 'ai-credit' },
    maxRedemptions: 1,
    metadata: { campaign: 'launch' },
  });
  assert.equal(batch.codes.length, 2);
  assert.equal(batch.codes[0]?.code, undefined);
  assert.match(batch.codes[0]?.maskedCode ?? '', /^TEAM/);
  assert.equal((await moduleCommercial.redeemCodes.list({ batchId: batch.batchId })).length, 2);
  const plainCode = batch.codes[0]?.metadata.rawCode;
  assert.equal(typeof plainCode, 'string');
  const redeemed = await moduleCommercial.redeemCodes.redeem({
    code: plainCode as string,
    subject: userSubject,
    email: 'User@Example.com',
    idempotencyKey: 'redeem-1',
  });
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.entitlement, 'redeem.access');
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: userSubject,
      entitlement: 'redeem.access',
    }),
    true
  );
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: userSubject, unit: 'ai-credit' })).balance,
    3
  );
  const redeemAttempts = await store.listAudit({
    productId: 'product-primitives',
    type: 'commercial.redeem_code.attempt',
  });
  assert.equal(
    redeemAttempts.some((record) => record.metadata.email === 'User@Example.com'),
    false
  );
  assert.ok(redeemAttempts.some((record) => record.metadata.contactMasked === 'u***@example.com'));
  assert.equal(
    (await moduleCommercial.redeemCodes.listRedemptions({ subject: userSubject })).length,
    1
  );
  assert.equal((await moduleCommercial.redeemCodes.freeze({ batchId: batch.batchId })).frozen, 1);
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: batch.codes[1]?.metadata.rawCode as string,
        subject: userSubject,
      })
    ).ok,
    false
  );

  await assert.rejects(
    () =>
      moduleCommercial.redeemCodes.createBatch({
        count: 0,
        maxRedemptions: 1,
      }),
    /MODULE_REDEEM_CODES_INVALID_COUNT/
  );
  const boundBatch = await moduleCommercial.redeemCodes.createBatch({
    count: 1,
    prefix: 'BOUND',
    entitlement: 'bound.access',
    maxRedemptions: 1,
    bind: { email: 'bound@example.com' },
  });
  const boundCode = boundBatch.codes[0]?.metadata.rawCode as string;
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: boundCode,
        subject: userSubject,
        email: 'wrong@example.com',
      })
    ).ok,
    false
  );
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: userSubject,
      entitlement: 'bound.access',
    }),
    false
  );
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: boundCode,
        subject: userSubject,
        email: 'bound@example.com',
      })
    ).ok,
    true
  );
  const [boundRedemption] = await moduleCommercial.redeemCodes.listRedemptions({
    codeId: boundBatch.codes[0]?.id,
    subject: userSubject,
  });
  assert.equal(boundRedemption?.metadata.bind, '[REDACTED]');
  const expiredBatch = await moduleCommercial.redeemCodes.createBatch({
    count: 1,
    prefix: 'OLD',
    entitlement: 'expired.access',
    maxRedemptions: 1,
    expiresAt: '2000-01-01T00:00:00.000Z',
  });
  assert.equal(
    (
      await moduleCommercial.redeemCodes.list({
        batchId: expiredBatch.batchId,
        status: 'expired',
      })
    ).length,
    1
  );
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: expiredBatch.codes[0]?.metadata.rawCode as string,
        subject: userSubject,
      })
    ).ok,
    false
  );

  const riskEvent = await moduleCommercial.risk.record({
    subject: userSubject,
    type: 'redeem.suspicious',
    severity: 'high',
    source: 'redeem',
    sourceId: redeemed.redemption?.id,
  });
  assert.equal(riskEvent.severity, 'high');
  await moduleCommercial.risk.block({
    subject: userSubject,
    scope: 'redeem',
    reason: 'too_many_attempts',
    idempotencyKey: 'risk-block-1',
  });
  assert.deepEqual(await moduleCommercial.risk.check({ subject: userSubject, scope: 'redeem' }), {
    ok: false,
    reason: 'too_many_attempts',
  });
});
