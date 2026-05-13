/**
 * Service Bus Test
 *
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceBus } from '../service-bus';
import type { ServiceHandler } from '../transports/types';

describe('ServiceBus', () => {
  let serviceBus: ServiceBus;

  beforeEach(() => {
    serviceBus = new ServiceBus();
  });

  afterEach(() => {
    serviceBus.clear();
  });

  // ==========================================================================
  // ==========================================================================

  describe('Service Registration and Invocation', () => {
    it('shouldSuccessRegisterService并调用', async () => {
      const handler = vi.fn(async (payload: unknown) => {
        return { result: 'success', data: payload };
      });

      serviceBus.register('service:test@v1', 'test-plugin', handler);

      const result = await serviceBus.call(
        'service:test@v1',
        { value: 123 },
        {
          callerId: 'caller-plugin',
        }
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ result: 'success', data: { value: 123 } });
    });

    it('should正确传递metadata给Servicehandler', async () => {
      let receivedMetadata: any = null;

      const handler: ServiceHandler = async (_payload, metadata) => {
        receivedMetadata = metadata as any;
        return { ok: true };
      };

      serviceBus.register('service:test@v1', 'test-plugin', handler);

      await serviceBus.call(
        'service:test@v1',
        { test: 'data' },
        {
          callerId: 'caller-id',
          userId: 'user-123',
        }
      );

      expect(receivedMetadata).toBeTruthy();
      expect(receivedMetadata?.callerId).toBe('caller-id');
      expect(receivedMetadata!.userId).toBe('user-123');
      expect(receivedMetadata!.timeout).toBeGreaterThan(0);
    });

    it('shouldSupportsBack不同TypeofResult', async () => {
      //
      serviceBus.register('service:string@v1', 'plugin-a', async () => 'hello');
      const str = await serviceBus.call<string>(
        'service:string@v1',
        {},
        {
          callerId: 'test',
        }
      );
      expect(str).toBe('hello');

      //
      serviceBus.register('service:number@v1', 'plugin-b', async () => 42);
      const num = await serviceBus.call<number>(
        'service:number@v1',
        {},
        {
          callerId: 'test',
        }
      );
      expect(num).toBe(42);

      // Object
      serviceBus.register('service:object@v1', 'plugin-c', async () => ({
        id: 1,
        name: 'test',
      }));
      const obj = await serviceBus.call<{ id: number; name: string }>(
        'service:object@v1',
        {},
        { callerId: 'test' }
      );
      expect(obj).toEqual({ id: 1, name: 'test' });
    });

    it('调用does not existofServiceshouldThrowError', async () => {
      await expect(
        serviceBus.call('service:nonexistent@v1', {}, { callerId: 'test' })
      ).rejects.toThrow('Service not found');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Timeout Control', () => {
    it('超whenshouldin断Service调用', async () => {
      const slowHandler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return 'should not reach here';
      });

      serviceBus.register('service:slow@v1', 'slow-plugin', slowHandler);

      await expect(
        serviceBus.call('service:slow@v1', {}, { callerId: 'test', timeout: 100 })
      ).rejects.toThrow('timeout');
    });

    it('shouldUsedefaultTimeout', async () => {
      const handler = vi.fn(async () => 'quick response');

      serviceBus.register('service:quick@v1', 'quick-plugin', handler);

      const result = await serviceBus.call(
        'service:quick@v1',
        {},
        {
          callerId: 'test',
        }
      );

      expect(result).toBe('quick response');
    });

    it('customTimeoutshould生效', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'delayed response';
      });

      serviceBus.register('service:delayed@v1', 'delayed-plugin', handler);

      const result = await serviceBus.call(
        'service:delayed@v1',
        {},
        {
          callerId: 'test',
          timeout: 500,
        }
      );

      expect(result).toBe('delayed response');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Error Handling', () => {
    it('ServiceThrowofErrorshouldbe传播', async () => {
      const errorHandler = vi.fn(async () => {
        throw new Error('Service internal error');
      });

      serviceBus.register('service:error@v1', 'error-plugin', errorHandler);

      await expect(serviceBus.call('service:error@v1', {}, { callerId: 'test' })).rejects.toThrow(
        'Service internal error'
      );

      expect(errorHandler).toHaveBeenCalled();
    });

    it('同步Errorshouldbe正确处理', async () => {
      serviceBus.register('service:sync-error@v1', 'plugin', () => {
        throw new Error('Sync error');
      });

      await expect(
        serviceBus.call('service:sync-error@v1', {}, { callerId: 'test' })
      ).rejects.toThrow('Sync error');
    });

    it('AsyncErrorshouldbe正确处理', async () => {
      serviceBus.register('service:async-error@v1', 'plugin', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('Async error');
      });

      await expect(
        serviceBus.call('service:async-error@v1', {}, { callerId: 'test' })
      ).rejects.toThrow('Async error');
    });
  });

  // ==========================================================================
  // 4. ServiceManage
  // ==========================================================================

  describe('Service Management', () => {
    it('should允许覆盖RegisteredofService', () => {
      const handler1 = vi.fn(async () => 'v1');
      const handler2 = vi.fn(async () => 'v2');

      serviceBus.register('service:test@v1', 'plugin-a', handler1);
      serviceBus.register('service:test@v1', 'plugin-b', handler2);

      expect(serviceBus.getProvider('service:test@v1')).toBe('plugin-b');
    });

    it('shouldSuccess注销Service', async () => {
      const handler = vi.fn(async () => 'test');

      serviceBus.register('service:test@v1', 'test-plugin', handler);
      expect(serviceBus.hasService('service:test@v1')).toBe(true);

      serviceBus.unregister('service:test@v1', 'test-plugin');
      expect(serviceBus.hasService('service:test@v1')).toBe(false);

      // ofServiceshouldFailed
      await expect(serviceBus.call('service:test@v1', {}, { callerId: 'test' })).rejects.toThrow(
        'Service not found'
      );
    });

    it('不should允许OtherPlugin注销Service', () => {
      serviceBus.register('service:test@v1', 'plugin-a', async () => 'test');

      serviceBus.unregister('service:test@v1', 'plugin-b');

      expect(serviceBus.hasService('service:test@v1')).toBe(true);
      expect(serviceBus.getProvider('service:test@v1')).toBe('plugin-a');
    });

    it('should移除PluginofAllService', async () => {
      serviceBus.register('service:a@v1', 'test-plugin', async () => 'a');
      serviceBus.register('service:b@v1', 'test-plugin', async () => 'b');
      serviceBus.register('service:c@v1', 'other-plugin', async () => 'c');

      expect(serviceBus.listServices()).toHaveLength(3);

      serviceBus.removeAllServices('test-plugin');

      expect(serviceBus.listServices()).toHaveLength(1);
      expect(serviceBus.hasService('service:c@v1')).toBe(true);
      expect(serviceBus.hasService('service:a@v1')).toBe(false);
      expect(serviceBus.hasService('service:b@v1')).toBe(false);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Query Operations', () => {
    it('hasServiceshould正确BackService存at性', () => {
      expect(serviceBus.hasService('service:test@v1')).toBe(false);

      serviceBus.register('service:test@v1', 'test-plugin', async () => 'test');

      expect(serviceBus.hasService('service:test@v1')).toBe(true);
    });

    it('getProvidershouldBack正确of提供者', () => {
      serviceBus.register('service:test@v1', 'test-plugin', async () => 'test');

      expect(serviceBus.getProvider('service:test@v1')).toBe('test-plugin');
      expect(serviceBus.getProvider('service:nonexistent@v1')).toBeUndefined();
    });

    it('listServicesshouldBackAllRegisteredofService', () => {
      expect(serviceBus.listServices()).toEqual([]);

      serviceBus.register('service:a@v1', 'plugin-a', async () => 'a');
      serviceBus.register('service:b@v1', 'plugin-b', async () => 'b');
      serviceBus.register('service:c@v1', 'plugin-c', async () => 'c');

      const services = serviceBus.listServices();
      expect(services).toHaveLength(3);
      expect(services).toContain('service:a@v1');
      expect(services).toContain('service:b@v1');
      expect(services).toContain('service:c@v1');
      // shouldSort
      expect(services).toEqual([...services].sort());
    });

    it('getPluginServicesshouldBackPlugin提供ofAllService', () => {
      serviceBus.register('service:a@v1', 'plugin-a', async () => 'a');
      serviceBus.register('service:b@v1', 'plugin-a', async () => 'b');
      serviceBus.register('service:c@v1', 'plugin-b', async () => 'c');

      const servicesA = serviceBus.getPluginServices('plugin-a');
      expect(servicesA).toHaveLength(2);
      expect(servicesA).toContain('service:a@v1');
      expect(servicesA).toContain('service:b@v1');

      const servicesB = serviceBus.getPluginServices('plugin-b');
      expect(servicesB).toHaveLength(1);
      expect(servicesB).toContain('service:c@v1');

      const servicesC = serviceBus.getPluginServices('plugin-c');
      expect(servicesC).toEqual([]);
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Input Validation', () => {
    it('should拒绝空ofServiceName', () => {
      expect(() => {
        serviceBus.register('', 'test-plugin', async () => 'test');
      }).toThrow();
    });

    it('should拒绝空ofpluginId', () => {
      expect(() => {
        serviceBus.register('service:test@v1', '', async () => 'test');
      }).toThrow();
    });

    it('should拒绝非Functionofhandler', () => {
      expect(() => {
        // @ts-expect-error - Testing runtime validation with invalid handler type
        serviceBus.register('service:test@v1', 'test-plugin', 'not-a-function');
      }).toThrow();
    });

    it('should reject service name without colon', () => {
      expect(() => {
        serviceBus.register('invalid-name', 'test-plugin', async () => 'test');
      }).toThrow('must contain a colon separator');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Concurrent Calls', () => {
    it('shouldSupports并发调用同一Service', async () => {
      let callCount = 0;

      serviceBus.register('service:test@v1', 'test-plugin', async (payload: unknown) => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          callId:
            payload && typeof payload === 'object' && 'callId' in payload
              ? (payload as { callId: number }).callId
              : 0,
          count: callCount,
        };
      });

      const results = await Promise.all([
        serviceBus.call('service:test@v1', { callId: 1 }, { callerId: 'test' }),
        serviceBus.call('service:test@v1', { callId: 2 }, { callerId: 'test' }),
        serviceBus.call('service:test@v1', { callId: 3 }, { callerId: 'test' }),
      ]);

      expect(results).toHaveLength(3);
      expect(callCount).toBe(3);
    });

    it('shouldSupports并发调用不同Service', async () => {
      serviceBus.register('service:a@v1', 'plugin-a', async () => 'result-a');
      serviceBus.register('service:b@v1', 'plugin-b', async () => 'result-b');
      serviceBus.register('service:c@v1', 'plugin-c', async () => 'result-c');

      const [a, b, c] = await Promise.all([
        serviceBus.call('service:a@v1', {}, { callerId: 'test' }),
        serviceBus.call('service:b@v1', {}, { callerId: 'test' }),
        serviceBus.call('service:c@v1', {}, { callerId: 'test' }),
      ]);

      expect(a).toBe('result-a');
      expect(b).toBe('result-b');
      expect(c).toBe('result-c');
    });
  });
});
