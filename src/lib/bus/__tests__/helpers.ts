/**
 * Event Bus å¨´å¬­ç¯æå­å§ªå®¸ã¥å¿
 *
 * æ©æ¬éToolå¦æ¬¢Canå­æEvent Buså¨´å¬­ç¯æ¶îç¶é¢ã§æ®å®¸ã¥å¿Functionéä¸®ockCreateCan£ã¥æ°Toolî¡âæå­å§ª, * æ¶æ´ææµåº¡ç´å§ã¤ç°¨æµ è·ºî©éåâ¬ä½½î¹éå¯î¸éåæ°Errorî¤éæîå¨´å¬­ç¯, */

import { vi, expect } from 'vitest';
import type { EventMetadata, EventHandler } from '../transports/types';

// ============================================================================
// Mock Handler CreateCan£?// ============================================================================

/**
 * Createa îçCanæ æ®Event Handler Mock
 *
 * @param implementation - Canîâ¬å¤æ®ç¹çµå¹Function
 * @returns Mock event handler
 *
 * @example
 * ```typescript
 * const handler = createMockEventHandler();
 * eventBus.on('user.created', 'test-plugin', handler);
 * ```
 */
export function createMockEventHandler(
  implementation?: (_payload: unknown, _metadata: EventMetadata) => void | Promise<void>
) {
  if (implementation) {
    return vi.fn(implementation);
  }
  return vi.fn(async (_payload: unknown, _metadata: EventMetadata) => {
    //
  });
}

/**
 * Createa îîè¤°æå¸´Toolèµæé¹î¾æ®Handler
 *
 * @param log - é¢ã¤ç°¬Recordé¨å¬æç¼? * @returns Mock handler
 *
 * @example
 * ```typescript
 * const receivedPayloads: any[] = [];
 * const handler = createRecordingHandler(receivedPayloads);
 *
 * // Back * expect(receivedPayloads).toHaveLength(1);
 * expect(receivedPayloads[0]).toEqual({ userId: '123' });
 * ```
 */
export function createRecordingHandler(
  log: Array<{ payload: unknown; metadata: EventMetadata; timestamp: Date }>
) {
  return vi.fn(async (_payload: unknown, _metadata: EventMetadata) => {
    log.push({ payload: _payload, metadata: _metadata, timestamp: new Date() });
  });
}

/**
 * Createa îç´°é¶æ¶å­Errorî¤é¨åvent Handler
 *
 * @param errorMessage - Errorî¤å¨å ä¼
 * @returns Mock handler
 */
export function createFailingEventHandler(errorMessage: string = 'Handler failed') {
  return vi.fn(async (_payload: unknown, _metadata: EventMetadata) => {
    throw new Error(errorMessage);
  });
}

/**
 * Createa îæ¬¢æ©ç¸å¢½çå²æ®Event Handler
 *
 * @param delay - å¯¤æ°ç¹Timeéå î ç»æç´
 * @param implementation - Canîâ¬å¤æ®ç¹çµå¹
 * @returns Mock handler
 */
export function createDelayedEventHandler(
  delay: number,
  implementation?: (_payload: unknown, _metadata: EventMetadata) => void | Promise<void>
) {
  return vi.fn(async (_payload: unknown, _metadata: EventMetadata) => {
    await waitForEventProcessing(delay);
    if (implementation) {
      await implementation(_payload, _metadata);
    }
  });
}

/**
 * Createa îç«Nameé¨å¥andleréå ç©¶æµåº¤ççæªç´
 *
 * @param name - HandlerName
 * @returns Mock handler
 */
export function createNamedEventHandler(name: string) {
  const handler = vi.fn(async (_payload: unknown, _metadata: EventMetadata) => {
    console.log(`[Handler: ${name}] Received event from ${_metadata.emitterId}`);
  });

  Object.defineProperty(handler, 'name', { value: name });
  return handler;
}

// ============================================================================
// BatchSubscribeæå­å§ª
// ============================================================================

/**
 * BatchSubscribeæ¾¶æ°«éEvent
 *
 * @param eventBus - EventBusInstance
 * @param subscriptions - SubscribeInformationArray
 *
 * @example
 * ```typescript
 * subscribeMultiple(eventBus, [
 *   { event: 'user.created', pluginId: 'plugin-a', handler: h1 },
 *   { event: 'user.updated', pluginId: 'plugin-b', handler: h2 },
 * ]);
 * ```
 */
export function subscribeMultiple(
  eventBus: {
    on: (event: string, pluginId: string, handler: EventHandler) => void;
    emit: (event: string, emitterId: string, payload: unknown) => Promise<void>;
    clear: () => void;
    getListeners: (event: string) => string[];
  },
  subscriptions: Array<{
    event: string;
    pluginId: string;
    handler: EventHandler;
  }>
) {
  subscriptions.forEach(({ event, pluginId, handler }) => {
    eventBus.on(event, pluginId, handler);
  });
}

// ============================================================================
//
// ============================================================================

/**
 * WaitEventProcessComplete
 *
 * é¢åç°¬EventBusToolîç´å§ã§æ®éåire-and-forgetéå¤ç´
 * é´ææ»Needä½ºçå¯°å¬ç«´å¨å«æ¤éç£îhandlersCan¦ã¥æCançå¢½çå±½ç¬é´æ©â¬? *
 * @param ms - WaitTimeéå î ç»æç´éå²ç²¯ç?0ms
 *
 * @example
 * ```typescript
 * await eventBus.emit('user.created', 'auth', { userId: '123' });
 * await waitForEventProcessing(100); // handlersExecuteî
 * expect(handler).toHaveBeenCalled();
 * ```
 */
export async function waitForEventProcessing(ms: number = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * WaitHandlerçî¥çé¢? *
 * æî¿îå¦«â¬ToolîockFunctionToolîæçî¥çé¢îç´é©æåSuccessé´æ ¬ç§´Toolèº²â¬? *
 * @param mockHandler - Mock handlerFunction
 * @param timeout - TimeoutTimeéå î ç»æç´
 * @param interval - å¦«â¬Toolã©æ£¿éæç´å§£î¤î) * @returns ToolîæCan¦ã¨ç§´Toolè·ºå¢ çî¥çé¢? *
 * @example
 * ```typescript
 * const handler = createMockEventHandler();
 * eventBus.on('test.event', 'plugin', handler);
 *
 * await eventBus.emit('test.event', 'sender', {});
 *
 * const wasCalled = await waitForHandlerCall(handler, 1000);
 * expect(wasCalled).toBe(true);
 * ```
 */
export async function waitForHandlerCall(
  mockHandler: ReturnType<typeof vi.fn>,
  timeout: number = 5000,
  interval: number = 50
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (mockHandler.mock.calls.length > 0) {
      return true;
    }
    await waitForEventProcessing(interval);
  }

  return false;
}

/**
 * Waitæ¾¶æ°«éHandleré®åî¦çåªæ¤
 *
 * @param mockHandlers - Mock handlerArray
 * @param timeout - TimeoutTimeéå î ç»æç´
 * @returns Toolîæéµâ¬Toolå¡°andlersé®åî¦çåªæ¤
 */
export async function waitForAllHandlersCalled(
  mockHandlers: Array<ReturnType<typeof vi.fn>>,
  timeout: number = 5000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const allCalled = mockHandlers.every((handler) => handler.mock.calls.length > 0);
    if (allCalled) {
      return true;
    }
    await waitForEventProcessing(50);
  }

  return false;
}

// ============================================================================
// Function
// ============================================================================

/**
 * VerificationHandlerçî¥çé¢ã¤ç¬æµ¼ç²åæµåîConfirmî¾æ®Parameter
 *
 * @param mockHandler - Mock handler
 * @param expectedPayload - æ£°å¬æ¹¡é¨å¾ayload
 * @param expectedMetadata - æ£°å¬æ¹¡é¨å´etadataéå ¥å´Canåå°®é°å¶ç´
 *
 * @example
 * ```typescript
 * expectHandlerCalledWith(handler, { userId: '123' }, { timestamp: Date.now() });
 * ```
 */
export function expectHandlerCalledWith(
  mockHandler: ReturnType<typeof vi.fn>,
  expectedPayload?: unknown,
  expectedMetadata?: Partial<EventMetadata>
) {
  expect(mockHandler).toHaveBeenCalled();

  const [payload, metadata] = mockHandler.mock.calls[0];

  if (expectedPayload !== undefined) {
    expect(payload).toEqual(expectedPayload);
  }

  if (expectedMetadata) {
    expect(metadata).toMatchObject(expectedMetadata);
  }
}

/**
 * VerificationHandlerçî¥çé¢ã¤ç°¡é¸å§ç¾å¨âæ
 *
 * @param mockHandler - Mock handler
 * @param expectedCount - æ£°å¬æ¹¡çåªæ¤å¨âæ
 */
export function expectHandlerCallCount(
  mockHandler: ReturnType<typeof vi.fn>,
  expectedCount: number
) {
  expect(mockHandler.mock.calls.length).toBe(expectedCount);
}

/**
 * VerificationHandlerå¨âæ¹çî¥çé¢? *
 * @param mockHandler - Mock handler
 */
export function expectHandlerNotCalled(mockHandler: ReturnType<typeof vi.fn>) {
  expect(mockHandler).not.toHaveBeenCalled();
}

/**
 * Verificationéµâ¬Toolå¡andlersé®åî¦çåªæ¤
 *
 * @param mockHandlers - Mock handlerArray
 */
export function expectAllHandlersCalled(mockHandlers: Array<ReturnType<typeof vi.fn>>) {
  mockHandlers.forEach((handler, index) => {
    expect(handler).toHaveBeenCalled();
    if (!handler.mock.calls.length) {
      console.error(`Handler ${index} was not called`);
    }
  });
}

/**
 * VerificationMetadataç¼æ´ç¯ç¹å±¾æ£é¬? *
 * @param metadata - Event metadata
 */
export function expectValidMetadata(metadata: EventMetadata) {
  // Fieldî
  expect(metadata.emitterId).toBeDefined();
  expect(typeof metadata.emitterId).toBe('string');

  expect(metadata.timestamp).toBeInstanceOf(Date);
  expect(metadata.eventId).toBeDefined();
  expect(typeof metadata.eventId).toBe('string');
  expect(metadata.correlationId).toBeDefined();
  expect(typeof metadata.correlationId).toBe('string');

  // Ifçæ¨ºæ¹ªéå²ççä½ºbeCan¨å¬¶ç´
}

// ============================================================================
//
// ============================================================================

/**
 * å¨å¯æEventBusStatusä¾ç´å¨´å¬­ç¯Canåº¤çé¢îç´
 *
 * @param eventBus - EventBusInstance
 */
export function cleanupEventBus(eventBus: {
  on?: (event: string, pluginId: string, handler: EventHandler) => void;
  emit?: (event: string, emitterId: string, payload: unknown) => Promise<void>;
  clear?: () => void;
  getListeners?: (event: string) => string[];
}) {
  if (eventBus && typeof eventBus.clear === 'function') {
    eventBus.clear();
  }
}

// ============================================================================
// DataGenerateCan£?// ============================================================================

/**
 * Createå¨´å¬­ç¯é¢ã§æ®Payload
 *
 * @param type - PayloadType
 * @returns å¨´å¬­ç¯payload
 */
export function createTestPayload(type: 'user' | 'order' | 'generic' = 'generic'): unknown {
  switch (type) {
    case 'user':
      return {
        userId: 'test-user-123',
        email: 'test@example.com',
        name: 'Test User',
      };

    case 'order':
      return {
        orderId: 'test-order-456',
        items: [{ productId: 'prod-1', quantity: 2 }],
        total: 99.99,
      };

    case 'generic':
    default:
      return {
        id: 'test-id-789',
        data: 'test-data',
        timestamp: new Date().toISOString(),
      };
  }
}

/**
 * Createå¨´å¬­ç¯é¢ã§æ®Metadata
 *
 * @param overrides - çåæ´Defaultî»Can? * @returns Event metadata
 */
export function createTestMetadata(overrides?: Partial<EventMetadata>): EventMetadata {
  const eventId = overrides?.eventId || 'test-event-id';
  return {
    emitterId: overrides?.emitterId || 'test-emitter',
    timestamp: overrides?.timestamp || new Date(),
    eventId,
    correlationId: overrides?.correlationId || eventId,
    ...overrides,
  };
}

// ============================================================================
//
// ============================================================================

/**
 * å¨´å¬®åºemitActionsé¨å«æ¬¢æ©? *
 * @param eventBus - EventBusInstance
 * @param event - Event name
 * @param emitterId - Publishé°å¢D
 * @param payload - Payload
 * @returns å¯¤æ°ç¹Timeéå î ç»æç´
 */
export async function measureEmitLatency(
  eventBus: {
    on: (event: string, pluginId: string, handler: EventHandler) => void;
    emit: (event: string, emitterId: string, payload: unknown) => Promise<void>;
    clear: () => void;
    getListeners: (event: string) => string[];
  },
  event: string,
  emitterId: string,
  payload: unknown
): Promise<number> {
  const startTime = Date.now();
  await eventBus.emit(event, emitterId, payload);
  return Date.now() - startTime;
}

/**
 * Batchå¨´å¬®åºemitå¯¤æ°ç¹
 *
 * @param eventBus - EventBusInstance
 * @param count - å¨´å¬­ç¯å¨âæ
 * @returns å¯¤æ°ç¹Statisticsî¸
 */
export async function measureBatchEmitLatency(
  eventBus: {
    on: (event: string, pluginId: string, handler: EventHandler) => void;
    emit: (event: string, emitterId: string, payload: unknown) => Promise<void>;
    clear: () => void;
    getListeners: (event: string) => string[];
  },
  count: number = 100
): Promise<{
  min: number;
  max: number;
  avg: number;
  measurements: number[];
}> {
  const measurements: number[] = [];

  for (let i = 0; i < count; i++) {
    const latency = await measureEmitLatency(eventBus, 'perf.test', 'sender', { index: i });
    measurements.push(latency);
  }

  return {
    min: Math.min(...measurements),
    max: Math.max(...measurements),
    avg: measurements.reduce((a, b) => a + b, 0) / measurements.length,
    measurements,
  };
}

// ============================================================================
//
// ============================================================================

/**
 * PrintMock Handleré¨å®çé¢ã¤ä¿é­î¤ç´Debugé¢îç´
 *
 * @param mockHandler - Mock handler
 * @param name - HandlerName
 */
export function debugPrintHandlerCalls(
  mockHandler: ReturnType<typeof vi.fn>,
  name: string = 'Handler'
) {
  console.log(`\n===== ${name} Calls =====`);
  console.log(`Total calls: ${mockHandler.mock.calls.length}`);

  mockHandler.mock.calls.forEach((call: unknown[], index: number) => {
    const [payload, metadata] = call;
    console.log(`\nCall ${index + 1}:`);
    console.log(`  Payload:`, payload);
    console.log(`  Metadata:`, {
      emitterId:
        metadata && typeof metadata === 'object' && 'emitterId' in metadata
          ? metadata.emitterId
          : undefined,
      timestamp:
        metadata &&
        typeof metadata === 'object' &&
        'timestamp' in metadata &&
        metadata.timestamp instanceof Date
          ? metadata.timestamp.toISOString()
          : undefined,
    });
  });

  console.log('\n========================\n');
}

/**
 * PrintSubscribeInformationéå £ççæ æ¤) *
 * @param eventBus - EventBusInstance
 * @param event - Event name
 */
export function debugPrintSubscriptions(
  eventBus: {
    on?: (event: string, pluginId: string, handler: EventHandler) => void;
    emit?: (event: string, emitterId: string, payload: unknown) => Promise<void>;
    clear?: () => void;
    getListeners?: (event: string) => string[];
  },
  event: string
) {
  console.log(`\n===== Subscriptions for ${event} =====`);
  const listeners = eventBus.getListeners?.(event) || [];
  console.log(`Total subscribers: ${listeners.length}`);
  listeners.forEach((pluginId: string, index: number) => {
    console.log(`  ${index + 1}. ${pluginId}`);
  });
  console.log('\n========================================\n');
}

/**
 * Printé¬ÑåStatisticsî¸éå £ççæ æ¤) *
 * @param stats - é¬ÑåStatisticsî¸Data
 */
export function debugPrintPerfStats(stats: {
  min: number;
  max: number;
  avg: number;
  measurements: number[];
}) {
  console.log('\n===== Performance Statistics =====');
  console.log(`Min:  ${stats.min.toFixed(2)}ms`);
  console.log(`Max:  ${stats.max.toFixed(2)}ms`);
  console.log(`Avg:  ${stats.avg.toFixed(2)}ms`);
  console.log(`Samples: ${stats.measurements.length}`);
  console.log('\n==================================\n');
}
