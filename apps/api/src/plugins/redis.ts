import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    queues: Record<string, Queue>;
  }
}

const QUEUE_NAMES = [
  'email-fetch',
  'email-parse',
  'email-classify',
  'email-extract',
  'email-crm-match',
  'email-sync',
  'attachment-process',
] as const;

const redisPluginImpl: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      fastify.log.warn(`Redis reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
  });

  redis.on('connect', () => fastify.log.info('Redis connected'));
  redis.on('error', (err) => fastify.log.error({ err }, 'Redis error'));

  fastify.decorate('redis', redis);

  const queues: Record<string, Queue> = {};
  for (const name of QUEUE_NAMES) {
    queues[name] = new Queue(name, {
      connection: { url: config.REDIS_URL },
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
  fastify.decorate('queues', queues);

  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis and queues...');
    await Promise.all(Object.values(queues).map((q) => q.close()));
    redis.disconnect();
  });
};

export const redisPlugin = fp(redisPluginImpl, {
  name: 'redis',
});
