import { Worker, Job } from 'bullmq';
import Imap from 'imap';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';
import {
  getRedisConnection,
  QUEUE_NAMES,
  enqueue,
  moveToDlq,
} from '../lib/queue-definitions.js';
import { createIdempotencyManager } from '../lib/idempotency.js';
import Redis from 'ioredis';

const log = createChildLogger({ module: 'email-fetch-worker' });
const prisma = new PrismaClient();

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials:
    config.s3.accessKeyId && config.s3.secretAccessKey
      ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
      : undefined,
  forcePathStyle: config.s3.forcePathStyle,
});

const redis = new Redis(config.redis);
const idempotency = createIdempotencyManager(redis);

interface EmailFetchJobData {
  mailboxId: string;
  accountId: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapTls: boolean;
  folder: string;
}

function connectImap(jobData: EmailFetchJobData): Promise<Imap> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: jobData.imapUser,
      password: jobData.imapPassword,
      host: jobData.imapHost,
      port: jobData.imapPort,
      tls: jobData.imapTls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30_000,
      authTimeout: 15_000,
    });

    imap.once('ready', () => resolve(imap));
    imap.once('error', (err: Error) => {
      log.error({ err, mailboxId: jobData.mailboxId }, 'IMAP connection error');
      reject(err);
    });

    imap.connect();
  });
}

function openBox(imap: Imap, folder: string): Promise<Imap.Box> {
  return new Promise((resolve, reject) => {
    imap.openBox(folder, true, (err, box) => {
      if (err) reject(err);
      else resolve(box);
    });
  });
}

function searchSince(imap: Imap, since: Date): Promise<number[]> {
  return new Promise((resolve, reject) => {
    imap.search([['SINCE', since]], (err, results) => {
      if (err) reject(err);
      else resolve(results ?? []);
    });
  });
}

function fetchMessage(imap: Imap, uid: number): Promise<{ raw: Buffer; headers: Record<string, string[]> }> {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch([uid], { bodies: '', struct: true });
    let raw = Buffer.alloc(0);
    const headers: Record<string, string[]> = {};

    fetch.on('message', (msg) => {
      msg.on('body', (stream) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          raw = Buffer.concat(chunks);
        });
      });
      msg.once('attributes', (attrs) => {
        // Store UID info
        headers['x-imap-uid'] = [String(attrs.uid)];
        if (attrs.date) headers['date'] = [attrs.date.toISOString()];
      });
    });

    fetch.once('error', reject);
    fetch.once('end', () => resolve({ raw, headers }));
  });
}

function extractMessageId(raw: Buffer): string | null {
  const text = raw.toString('utf-8', 0, Math.min(raw.length, 8192));
  const match = text.match(/^message-id:\s*(<[^>]+>)/im);
  return match ? match[1] : null;
}

async function processJob(job: Job<EmailFetchJobData>): Promise<void> {
  const { data } = job;
  const jobLog = log.child({ jobId: job.id, mailboxId: data.mailboxId });

  jobLog.info('Starting email fetch');

  let imap: Imap | null = null;

  try {
    // Get last sync state
    const syncState = await prisma.mailboxSyncState?.findUnique?.({
      where: { mailboxId: data.mailboxId },
    }).catch(() => null);

    const since = syncState?.lastSyncedAt
      ? new Date(syncState.lastSyncedAt)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours

    imap = await connectImap(data);
    await openBox(imap, data.folder);

    const uids = await searchSince(imap, since);
    jobLog.info({ count: uids.length, since: since.toISOString() }, 'Found emails to fetch');

    let processed = 0;
    let skipped = 0;

    for (const uid of uids) {
      try {
        const { raw } = await fetchMessage(imap, uid);
        const messageId = extractMessageId(raw) ?? `uid-${uid}-${data.mailboxId}`;

        // Idempotency check
        const idempotencyKey = idempotency.generateKey(messageId, data.mailboxId);
        if (await idempotency.checkProcessed(idempotencyKey)) {
          skipped++;
          continue;
        }

        // Store raw email in S3
        const s3Key = `raw-emails/${data.accountId}/${data.mailboxId}/${Date.now()}-${uid}.eml`;
        await s3.send(
          new PutObjectCommand({
            Bucket: config.s3.bucket,
            Key: s3Key,
            Body: raw,
            ContentType: 'message/rfc822',
          }),
        );

        // Create Email record
        const email = await prisma.email.create({
          data: {
            messageId,
            mailboxId: data.mailboxId,
            accountId: data.accountId,
            rawStoragePath: s3Key,
            status: 'received',
            receivedAt: new Date(),
            imapUid: uid,
          },
        });

        // Mark as processed for idempotency
        await idempotency.markProcessed(idempotencyKey, { emailId: email.id });

        // Enqueue to parse
        await enqueue(QUEUE_NAMES.EMAIL_PARSE, 'parse-email', {
          emailId: email.id,
          rawStoragePath: s3Key,
        });

        processed++;
        await job.updateProgress(Math.round((processed / uids.length) * 100));
      } catch (err) {
        jobLog.error({ err, uid }, 'Failed to process individual email');
        // Continue with other emails
      }
    }

    // Update sync state
    await prisma.mailboxSyncState?.upsert?.({
      where: { mailboxId: data.mailboxId },
      create: {
        mailboxId: data.mailboxId,
        lastSyncedAt: new Date(),
        lastUid: uids.length > 0 ? Math.max(...uids) : undefined,
        emailsFetched: processed,
      },
      update: {
        lastSyncedAt: new Date(),
        lastUid: uids.length > 0 ? Math.max(...uids) : undefined,
        emailsFetched: { increment: processed },
      },
    }).catch((err: unknown) => {
      jobLog.warn({ err }, 'Failed to update sync state');
    });

    jobLog.info({ processed, skipped, total: uids.length }, 'Email fetch completed');
  } finally {
    if (imap) {
      try {
        imap.end();
      } catch {
        // Ignore close errors
      }
    }
  }
}

export function createEmailFetchWorker(): Worker {
  const worker = new Worker<EmailFetchJobData>(
    QUEUE_NAMES.EMAIL_FETCH,
    async (job) => {
      await processJob(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: config.workers.emailFetchConcurrency,
      limiter: {
        max: 10,
        duration: 60_000,
      },
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Email fetch job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Email fetch job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      moveToDlq(QUEUE_NAMES.EMAIL_FETCH, job.data, err).catch((dlqErr) => {
        log.error({ dlqErr }, 'Failed to move job to DLQ');
      });
    }
  });

  worker.on('error', (err) => {
    log.error({ err }, 'Email fetch worker error');
  });

  log.info('Email fetch worker started');
  return worker;
}
