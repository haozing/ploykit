/**
 * Rate Limiter - Token Bucket Algorithm Implementation
 *
 * Features:
 * - Token bucket algorithm for smooth rate limiting
 * - Per-key rate limiting (e.g., by pluginId, userId)
 * - Automatic bucket cleanup for inactive keys
 * - Configurable burst capacity
 *
 * Usage:
 * ```typescript
 * const limiter = new RateLimiter({ tokensPerInterval: 100, interval: 1000 });
 * await limiter.removeTokens(pluginId, 1); // throws TooManyRequestsError if exceeded
 * ```
 */

import { AppError } from './errors';

/**
 * Too Many Requests Error (429)
 */
export class TooManyRequestsError extends AppError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, 'TOO_MANY_REQUESTS', 429, metadata);
    this.name = 'TooManyRequestsError';
  }
}

/**
 * Rate Limiter Configuration
 */
export interface RateLimiterConfig {
  /** Tokens to refill per interval */
  tokensPerInterval: number;

  /** Interval in milliseconds */
  interval: number;

  /** Maximum tokens (burst capacity), defaults to tokensPerInterval */
  maxTokens?: number;
}

/**
 * Bucket State
 */
interface Bucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Token Bucket Rate Limiter
 *
 * How it works:
 * 1. Each key (e.g., pluginId) gets its own bucket
 * 2. Buckets start with maxTokens capacity
 * 3. Each request consumes N tokens
 * 4. Tokens refill gradually over time based on elapsed duration
 * 5. Inactive buckets are cleaned up periodically
 */
export class RateLimiter {
  private readonly config: Required<RateLimiterConfig>;
  private readonly buckets = new Map<string, Bucket>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RateLimiterConfig) {
    this.config = {
      tokensPerInterval: config.tokensPerInterval,
      interval: config.interval,
      maxTokens: config.maxTokens ?? config.tokensPerInterval,
    };

    // Start cleanup interval (runs every 60 seconds)
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Consume tokens from the bucket
   *
   * @param key - Unique identifier (e.g., pluginId, userId)
   * @param tokens - Number of tokens to consume (default: 1)
   * @throws TooManyRequestsError if rate limit exceeded
   */
  async removeTokens(key: string, tokens: number = 1): Promise<void> {
    const bucket = this.getOrCreateBucket(key);

    // Refill tokens based on elapsed time
    this.refillTokens(bucket);

    // Check if enough tokens available
    if (bucket.tokens < tokens) {
      const waitTime = this.calculateWaitTime(bucket, tokens);
      throw new TooManyRequestsError(`Rate limit exceeded for "${key}"`, {
        key,
        limit: this.config.tokensPerInterval,
        interval: this.config.interval,
        retryAfter: Math.ceil(waitTime / 1000), // seconds
      });
    }

    // Consume tokens
    bucket.tokens -= tokens;
  }

  /**
   * Get or create a bucket for the given key
   */
  private getOrCreateBucket(key: string): Bucket {
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.config.maxTokens,
        lastRefill: Date.now(),
      };
      this.buckets.set(key, bucket);
    }

    return bucket;
  }

  /**
   * Refill tokens based on elapsed time since last refill
   */
  private refillTokens(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;

    if (elapsed > 0) {
      // Calculate tokens to add based on elapsed time
      const tokensToAdd = (elapsed / this.config.interval) * this.config.tokensPerInterval;
      bucket.tokens = Math.min(this.config.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  /**
   * Calculate wait time needed to accumulate required tokens
   */
  private calculateWaitTime(bucket: Bucket, tokensNeeded: number): number {
    const tokensShort = tokensNeeded - bucket.tokens;
    const timePerToken = this.config.interval / this.config.tokensPerInterval;
    return tokensShort * timePerToken;
  }

  /**
   * Clean up inactive buckets (older than 10 minutes)
   */
  private cleanup(): void {
    const now = Date.now();
    const inactiveThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > inactiveThreshold) {
        this.buckets.delete(key);
      }
    }
  }

  /**
   * Destroy the rate limiter and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
  }

  /**
   * Get current bucket status (for debugging)
   */
  getStatus(key: string): { tokens: number; maxTokens: number } | null {
    const bucket = this.buckets.get(key);
    if (!bucket) return null;

    this.refillTokens(bucket);
    return {
      tokens: Math.floor(bucket.tokens),
      maxTokens: this.config.maxTokens,
    };
  }
}

/**
 * Global rate limiter instance
 *
 * Default configuration: 100 requests per second with 200 burst capacity
 */
export const globalRateLimiter = new RateLimiter({
  tokensPerInterval: 100, // 100 tokens per interval
  interval: 1000, // 1 second
  maxTokens: 200, // burst capacity
});
