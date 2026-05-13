/**
 * Common Test Helpers
 *
 * Utility functions for testing across the application.
 */

/* eslint-disable no-console */
import { vi, expect } from 'vitest';

/**
 * Time utilities for testing
 */
export const timeUtils = {
  /**
   * Set a fixed date for Date.now() and new Date()
   */
  freezeTime: (date: Date | string) => {
    const fixedDate = new Date(date);
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);
    return fixedDate;
  },

  /**
   * Restore real timers
   */
  unfreezeTime: () => {
    vi.useRealTimers();
  },

  /**
   * Advance time by milliseconds
   */
  advanceTime: (ms: number) => {
    vi.advanceTimersByTime(ms);
  },

  /**
   * Advance time to next timer
   */
  advanceToNextTimer: () => {
    vi.runOnlyPendingTimers();
  },

  /**
   * Run all timers
   */
  runAllTimers: () => {
    vi.runAllTimers();
  },
};

/**
 * Async utilities for testing
 */
export const asyncUtils = {
  /**
   * Wait for a condition to be true
   */
  waitFor: async (
    condition: () => boolean | Promise<boolean>,
    options: { timeout?: number; interval?: number } = {}
  ): Promise<void> => {
    const { timeout = 5000, interval = 50 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Timeout waiting for condition after ${timeout}ms`);
  },

  /**
   * Wait for all pending promises to resolve
   */
  flushPromises: () => new Promise((resolve) => setImmediate(resolve)),
};

/**
 * Mock network utilities
 */
export const networkUtils = {
  /**
   * Create a mock fetch response
   */
  mockFetchResponse: (data: unknown, options: { status?: number; ok?: boolean } = {}) => {
    const { status = 200, ok = true } = options;
    return Promise.resolve({
      ok,
      status,
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: new Headers(),
    } as Response);
  },

  /**
   * Mock fetch with custom responses
   */
  mockFetch: (responses: Map<string, unknown>) => {
    return vi.fn((url: string) => {
      const response = responses.get(url);
      if (!response) {
        return Promise.reject(new Error(`No mock response for ${url}`));
      }
      return networkUtils.mockFetchResponse(response);
    });
  },
};

/**
 * Environment variable utilities
 */
export const envUtils = {
  /**
   * Set environment variables for a test
   */
  setEnv: (vars: Record<string, string>) => {
    const original: Record<string, string | undefined> = {};
    Object.entries(vars).forEach(([key, value]) => {
      original[key] = process.env[key];
      process.env[key] = value;
    });
    return () => {
      Object.entries(original).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
    };
  },
};

/**
 * Logging utilities for tests
 */
export const logUtils = {
  /**
   * Suppress console output during tests
   */
  suppressConsole: () => {
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug,
    };

    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();
    console.info = vi.fn();
    console.debug = vi.fn();

    return () => {
      console.log = originalConsole.log;
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
      console.info = originalConsole.info;
      console.debug = originalConsole.debug;
    };
  },

  /**
   * Capture console output during tests
   */
  captureConsole: () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
    };

    console.log = vi.fn((...args) => logs.push(args.join(' ')));
    console.error = vi.fn((...args) => errors.push(args.join(' ')));
    console.warn = vi.fn((...args) => warnings.push(args.join(' ')));

    return {
      logs,
      errors,
      warnings,
      restore: () => {
        console.log = originalConsole.log;
        console.error = originalConsole.error;
        console.warn = originalConsole.warn;
      },
    };
  },
};

/**
 * Error testing utilities
 */
export const errorUtils = {
  /**
   * Assert that a function throws a specific error
   */
  expectError: async (
    fn: () => unknown | Promise<unknown>,
    expectedMessage?: string | RegExp
  ): Promise<Error> => {
    try {
      await fn();
      throw new Error('Expected function to throw an error');
    } catch (error) {
      if (error instanceof Error) {
        if (expectedMessage) {
          if (typeof expectedMessage === 'string') {
            expect(error.message).toContain(expectedMessage);
          } else {
            expect(error.message).toMatch(expectedMessage);
          }
        }
        return error;
      }
      throw error;
    }
  },

  /**
   * Create a mock error with specific properties
   */
  createMockError: (message: string, code?: string, statusCode?: number) => {
    const error = new Error(message) as Error & {
      code?: string;
      statusCode?: number;
    };
    if (code) error.code = code;
    if (statusCode) error.statusCode = statusCode;
    return error;
  },
};

/**
 * Data generation utilities
 */
export const dataUtils = {
  /**
   * Generate a random UUID (for testing)
   */
  uuid: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },

  /**
   * Generate random email
   */
  email: () => {
    return `test-${Math.random().toString(36).substring(7)}@example.com`;
  },

  /**
   * Generate random string
   */
  randomString: (length: number = 10) => {
    return Math.random()
      .toString(36)
      .substring(2, 2 + length);
  },

  /**
   * Generate random number in range
   */
  randomInt: (min: number, max: number) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * Generate an array of items using a factory
   */
  generateArray: <T>(count: number, factory: (index: number) => T): T[] => {
    return Array.from({ length: count }, (_, i) => factory(i));
  },
};

/**
 * Assertion utilities
 */
export const assertUtils = {
  /**
   * Assert object matches partial shape
   */
  assertPartialMatch: <T extends object>(actual: T, expected: Partial<T>) => {
    Object.entries(expected).forEach(([key, value]) => {
      expect(actual).toHaveProperty(key, value);
    });
  },

  /**
   * Assert array contains items matching partial shape
   */
  assertArrayContains: <T extends object>(array: T[], expected: Partial<T>) => {
    const found = array.some((item) =>
      Object.entries(expected).every(([key, value]) => item[key as keyof T] === value)
    );
    expect(found).toBe(true);
  },

  /**
   * Assert date is close to expected (within tolerance)
   */
  assertDateClose: (actual: Date, expected: Date, toleranceMs: number = 1000) => {
    const diff = Math.abs(actual.getTime() - expected.getTime());
    expect(diff).toBeLessThanOrEqual(toleranceMs);
  },

  /**
   * Assert object has all required keys
   */
  assertHasKeys: <T extends object>(obj: T, keys: (keyof T)[]) => {
    keys.forEach((key) => {
      expect(obj).toHaveProperty(String(key));
    });
  },
};

/**
 * Cleanup utilities
 */
export const cleanupUtils = {
  /**
   * Register cleanup functions to run after test
   */
  cleanup: [] as Array<() => void | Promise<void>>,

  /**
   * Add cleanup function
   */
  addCleanup: (fn: () => void | Promise<void>) => {
    cleanupUtils.cleanup.push(fn);
  },

  /**
   * Run all cleanup functions
   */
  runCleanup: async () => {
    for (const fn of cleanupUtils.cleanup) {
      await fn();
    }
    cleanupUtils.cleanup = [];
  },
};
