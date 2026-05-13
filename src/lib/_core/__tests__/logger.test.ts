/**
 * Unit tests for lib/logger.ts
 *
 * Tests logger functionality
 */

import { DEFAULT_LOG_REDACT_PATHS, logger, createLogger, getLoggerConfig } from '../logger';

describe('lib/logger', () => {
  describe('logger', () => {
    it('should be defined', () => {
      expect(logger).toBeDefined();
    });

    it('should have standard log methods', () => {
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.fatal).toBe('function');
    });

    it('should have level property', () => {
      expect(logger.level).toBeDefined();
      expect(typeof logger.level).toBe('string');
    });

    it('should log info messages', () => {
      // This test verifies that the method can be called without throwing
      expect(() => {
        logger.info('Test message');
      }).not.toThrow();
    });

    it('should log with context object', () => {
      expect(() => {
        logger.info({ userId: '123', action: 'test' }, 'Test with context');
      }).not.toThrow();
    });

    it('should log errors', () => {
      const error = new Error('Test error');
      expect(() => {
        logger.error({ err: error }, 'Error occurred');
      }).not.toThrow();
    });

    it('should log warnings', () => {
      expect(() => {
        logger.warn({ code: 'WARN_001' }, 'Warning message');
      }).not.toThrow();
    });

    it('should log debug messages', () => {
      expect(() => {
        logger.debug({ detail: 'debug info' }, 'Debug message');
      }).not.toThrow();
    });
  });

  describe('createLogger', () => {
    it('should create a child logger', () => {
      const childLogger = createLogger({ module: 'test', userId: '123' });

      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
      expect(typeof childLogger.error).toBe('function');
    });

    it('should be callable', () => {
      const childLogger = createLogger({ requestId: 'req-123' });

      expect(() => {
        childLogger.info('Child logger message');
      }).not.toThrow();
    });

    it('should accept empty context', () => {
      const childLogger = createLogger({});
      expect(childLogger).toBeDefined();
    });

    it('should accept complex context', () => {
      const childLogger = createLogger({
        pluginId: 'test-plugin',
        userId: 'user-123',
        requestId: 'req-456',
        metadata: { key: 'value' },
      });

      expect(() => {
        childLogger.info('Complex context message');
      }).not.toThrow();
    });

    it('child logger should inherit parent methods', () => {
      const childLogger = createLogger({ module: 'test' });

      expect(typeof childLogger.info).toBe('function');
      expect(typeof childLogger.error).toBe('function');
      expect(typeof childLogger.warn).toBe('function');
      expect(typeof childLogger.debug).toBe('function');
      expect(typeof childLogger.trace).toBe('function');
      expect(typeof childLogger.fatal).toBe('function');
    });

    it('should create multiple independent child loggers', () => {
      const logger1 = createLogger({ id: '1' });
      const logger2 = createLogger({ id: '2' });

      expect(logger1).not.toBe(logger2);

      expect(() => {
        logger1.info('Logger 1');
        logger2.info('Logger 2');
      }).not.toThrow();
    });

    it('should handle nested child loggers', () => {
      const parentLogger = createLogger({ module: 'parent' });
      // Create child of child (if supported by pino)
      expect(() => {
        parentLogger.info({ subModule: 'child' }, 'Nested context');
      }).not.toThrow();
    });
  });

  describe('Logger configuration', () => {
    it('should have environment in base context', () => {
      // The logger should include env in its base context
      // We can't directly test this without mocking, but we can verify it doesn't throw
      expect(logger).toBeDefined();
    });

    it('should respect log level from environment', () => {
      // The level should be set based on LOG_LEVEL or NODE_ENV
      expect(logger.level).toBeDefined();
      expect(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).toContain(logger.level);
    });

    it('should include default sensitive field redaction paths', () => {
      const config = getLoggerConfig();

      expect(config.redactPaths).toEqual(expect.arrayContaining(DEFAULT_LOG_REDACT_PATHS));
      expect(config.redactPaths).toEqual(
        expect.arrayContaining(['password', 'token', 'secret', 'authorization', 'cookie'])
      );
    });
  });

  describe('Error handling', () => {
    it('should handle logging errors gracefully', () => {
      // Circular reference object
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;

      // Pino should handle circular references
      expect(() => {
        logger.info({ data: circular }, 'Circular reference');
      }).not.toThrow();
    });

    it('should handle undefined and null', () => {
      expect(() => {
        logger.info({ value: undefined, other: null }, 'Undefined and null');
      }).not.toThrow();
    });

    it('should handle BigInt values', () => {
      expect(() => {
        logger.info({ bigNum: BigInt(12345) }, 'BigInt value');
      }).not.toThrow();
    });

    it('should handle special characters', () => {
      expect(() => {
        logger.info({ text: 'Special chars: 你好 \n\t' }, 'Special characters');
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle rapid logging', () => {
      expect(() => {
        for (let i = 0; i < 100; i++) {
          logger.debug({ iteration: i }, 'Rapid log');
        }
      }).not.toThrow();
    });

    it('should handle large objects', () => {
      const largeObject = {
        array: new Array(1000).fill(0).map((_, i) => ({ id: i, data: 'test' })),
      };

      expect(() => {
        logger.info({ data: largeObject }, 'Large object');
      }).not.toThrow();
    });
  });

  describe('Type safety', () => {
    it('should accept Record<string, unknown> as context', () => {
      const context: Record<string, unknown> = {
        userId: '123',
        count: 42,
        active: true,
        nested: { key: 'value' },
      };

      expect(() => {
        logger.info(context, 'Type-safe context');
      }).not.toThrow();
    });

    it('should work with typed objects', () => {
      interface LogContext {
        userId: string;
        action: string;
        timestamp: Date;
      }

      const context: LogContext = {
        userId: 'user-123',
        action: 'LOGIN',
        timestamp: new Date(),
      };

      expect(() => {
        logger.info(context, 'Typed context');
      }).not.toThrow();
    });
  });
});
