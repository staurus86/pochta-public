import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'idempotency' });

const IDEMPOTENCY_PREFIX = 'pochta:idempotency:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface IdempotencyManager {
  generateKey(messageId: string, inbox: string): string;
  checkProcessed(key: string): Promise<boolean>;
  markProcessed(key: string, result?: Record<string, unknown>): Promise<void>;
  clearKey(key: string): Promise<void>;
}

export function createIdempotencyManager(
  redis: Redis,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): IdempotencyManager {
  return {
    generateKey(messageId: string, inbox: string): string {
      const raw = `${inbox}:${messageId}`;
      const hash = createHash('sha256').update(raw).digest('hex');
      return `${IDEMPOTENCY_PREFIX}${hash}`;
    },

    async checkProcessed(key: string): Promise<boolean> {
      try {
        const exists = await redis.exists(key);
        if (exists) {
          log.debug({ key }, 'Idempotency key already processed');
          return true;
        }
        return false;
      } catch (err) {
        log.error({ err, key }, 'Failed to check idempotency key');
        // On error, return false to allow processing (at-least-once semantics)
        return false;
      }
    },

    async markProcessed(key: string, result?: Record<string, unknown>): Promise<void> {
      try {
        const value = JSON.stringify({
          processedAt: new Date().toISOString(),
          ...result,
        });
        await redis.setex(key, ttlSeconds, value);
        log.debug({ key }, 'Marked idempotency key as processed');
      } catch (err) {
        log.error({ err, key }, 'Failed to mark idempotency key');
        throw err;
      }
    },

    async clearKey(key: string): Promise<void> {
      try {
        await redis.del(key);
        log.debug({ key }, 'Cleared idempotency key');
      } catch (err) {
        log.error({ err, key }, 'Failed to clear idempotency key');
      }
    },
  };
}
