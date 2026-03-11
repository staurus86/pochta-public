import { Queue, QueueOptions } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { config } from '../config.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'queues' });

export const QUEUE_NAMES = {
  EMAIL_FETCH: 'email-fetch',
  EMAIL_PARSE: 'email-parse',
  EMAIL_CLASSIFY: 'email-classify',
  EMAIL_EXTRACT: 'email-extract',
  EMAIL_CRM_MATCH: 'email-crm-match',
  EMAIL_SYNC: 'email-sync',
  ATTACHMENT_PROCESS: 'attachment-process',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

function dlqName(queueName: string): string {
  return `${queueName}-dlq`;
}

export const QUEUE_CONFIGS: Record<
  QueueName,
  { attempts: number; backoff: { type: 'exponential'; delay: number } }
> = {
  [QUEUE_NAMES.EMAIL_FETCH]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  },
  [QUEUE_NAMES.EMAIL_PARSE]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  },
  [QUEUE_NAMES.EMAIL_CLASSIFY]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  },
  [QUEUE_NAMES.EMAIL_EXTRACT]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  },
  [QUEUE_NAMES.EMAIL_CRM_MATCH]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  },
  [QUEUE_NAMES.EMAIL_SYNC]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
  },
  [QUEUE_NAMES.ATTACHMENT_PROCESS]: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
  },
};

export function getRedisConnection(): ConnectionOptions {
  return {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
    maxRetriesPerRequest: null,
  };
}

const queues = new Map<string, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    const queueConfig = QUEUE_CONFIGS[name];
    queue = new Queue(name, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: queueConfig.attempts,
        backoff: queueConfig.backoff,
        removeOnComplete: { count: 1000, age: 7 * 24 * 3600 },
        removeOnFail: { count: 5000, age: 30 * 24 * 3600 },
      },
    });
    queues.set(name, queue);
    log.info({ queue: name }, 'Queue created');
  }
  return queue;
}

const dlqs = new Map<string, Queue>();

export function getDlq(name: QueueName): Queue {
  const dlq = dlqName(name);
  let queue = dlqs.get(dlq);
  if (!queue) {
    queue = new Queue(dlq, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
    dlqs.set(dlq, queue);
    log.info({ queue: dlq }, 'DLQ created');
  }
  return queue;
}

export async function enqueue(
  queueName: QueueName,
  jobName: string,
  data: Record<string, unknown>,
  opts?: { priority?: number; delay?: number; jobId?: string },
): Promise<void> {
  const queue = getQueue(queueName);
  await queue.add(jobName, data, {
    priority: opts?.priority,
    delay: opts?.delay,
    jobId: opts?.jobId,
  });
  log.debug({ queue: queueName, jobName, jobId: opts?.jobId }, 'Job enqueued');
}

export async function moveToDlq(
  queueName: QueueName,
  jobData: Record<string, unknown>,
  error: Error,
): Promise<void> {
  const dlq = getDlq(queueName);
  await dlq.add('failed-job', {
    originalQueue: queueName,
    data: jobData,
    error: {
      message: error.message,
      stack: error.stack,
    },
    failedAt: new Date().toISOString(),
  });
  log.warn({ queue: queueName, error: error.message }, 'Job moved to DLQ');
}

export async function closeAllQueues(): Promise<void> {
  const allQueues = [...queues.values(), ...dlqs.values()];
  await Promise.all(allQueues.map((q) => q.close()));
  queues.clear();
  dlqs.clear();
  log.info('All queues closed');
}
