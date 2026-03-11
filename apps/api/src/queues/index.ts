import { Queue, Worker, Job } from 'bullmq';
import type { Logger } from 'pino';
import { PrismaClient } from '@prisma/client';
import { EmailPipeline } from '../services/email-pipeline.js';
import { ImapFetcher } from '../services/imap-fetcher.js';

/**
 * Queue name constants used across the application.
 */
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

/**
 * Job payload types for each queue.
 */
export interface EmailFetchPayload {
  inboxAccountId: string;
  triggeredBy?: string;
}

export interface EmailParsePayload {
  emailId: string;
  reprocessedBy?: string;
}

export interface EmailClassifyPayload {
  emailId: string;
}

export interface EmailExtractPayload {
  emailId: string;
}

export interface EmailCrmMatchPayload {
  emailId: string;
}

export interface EmailSyncPayload {
  emailId: string;
  approvedBy: string;
}

export interface AttachmentProcessPayload {
  attachmentId: string;
  emailId: string;
}

/**
 * Create BullMQ workers for all queues.
 * Call this from the worker process, not from the API server.
 */
export function createWorkers(
  redisUrl: string,
  prisma: PrismaClient,
  log: Logger,
): Worker[] {
  const connection = { url: redisUrl };
  const pipeline = new EmailPipeline(prisma, log);

  const workers: Worker[] = [];

  // --- Email Fetch Worker ---
  workers.push(
    new Worker<EmailFetchPayload>(
      QUEUE_NAMES.EMAIL_FETCH,
      async (job: Job<EmailFetchPayload>) => {
        const { inboxAccountId } = job.data;
        log.info({ jobId: job.id, inboxAccountId }, 'Processing email-fetch job');

        const account = await prisma.inboxAccount.findUnique({
          where: { id: inboxAccountId },
        });

        if (!account || !account.isActive) {
          log.warn({ inboxAccountId }, 'Inbox account not found or inactive');
          return { fetched: 0 };
        }

        const fetcher = new ImapFetcher(
          {
            host: account.imapHost,
            port: account.imapPort,
            user: account.imapUser,
            password: account.imapPassword,
            tls: account.imapTls,
          },
          log,
        );

        try {
          await fetcher.connect();
          const emails = await fetcher.fetchNewEmails(
            account.folders as string[],
            50,
          );

          // Store fetched emails and enqueue for parsing
          const parseQueue = new Queue(QUEUE_NAMES.EMAIL_PARSE, { connection });

          for (const rawEmail of emails) {
            const stored = await prisma.email.create({
              data: {
                inboxAccountId: account.id,
                messageId: rawEmail.messageId,
                inReplyTo: rawEmail.inReplyTo,
                subject: rawEmail.subject,
                senderEmail: rawEmail.fromEmail,
                senderName: rawEmail.fromName,
                toAddresses: rawEmail.toAddresses,
                ccAddresses: rawEmail.ccAddresses,
                bodyHtml: rawEmail.bodyHtml,
                bodyText: rawEmail.bodyText,
                receivedAt: rawEmail.date,
                headers: rawEmail.headers,
                status: 'pending',
              },
            });

            // Store attachments
            for (const att of rawEmail.attachments) {
              await prisma.attachment.create({
                data: {
                  emailId: stored.id,
                  filename: att.filename,
                  mimeType: att.mimeType,
                  size: att.size,
                },
              });
            }

            await parseQueue.add('parse', { emailId: stored.id });
          }

          // Mark as seen
          if (emails.length > 0) {
            const uids = emails.map((e) => e.uid);
            for (const folder of account.folders as string[]) {
              try {
                await fetcher.markAsSeen(folder, uids);
              } catch {
                // Non-critical
              }
            }
          }

          await fetcher.disconnect();
          await parseQueue.close();

          // Update account fetch status
          await prisma.inboxAccount.update({
            where: { id: inboxAccountId },
            data: {
              lastFetchAt: new Date(),
              lastFetchCount: emails.length,
              lastFetchError: null,
            },
          });

          return { fetched: emails.length };
        } catch (err) {
          await fetcher.disconnect().catch(() => {});

          const errorMsg = err instanceof Error ? err.message : 'Unknown fetch error';
          await prisma.inboxAccount.update({
            where: { id: inboxAccountId },
            data: {
              lastFetchAt: new Date(),
              lastFetchError: errorMsg,
            },
          });

          throw err;
        }
      },
      {
        connection,
        concurrency: 2,
        limiter: { max: 5, duration: 60_000 },
      },
    ),
  );

  // --- Email Parse Worker (runs full pipeline) ---
  workers.push(
    new Worker<EmailParsePayload>(
      QUEUE_NAMES.EMAIL_PARSE,
      async (job: Job<EmailParsePayload>) => {
        const { emailId } = job.data;
        log.info({ jobId: job.id, emailId }, 'Processing email-parse job');

        const result = await pipeline.process(emailId);
        return {
          emailId,
          classification: result.classification.label,
          status: result.status,
        };
      },
      {
        connection,
        concurrency: 5,
      },
    ),
  );

  // --- Email Classify Worker ---
  workers.push(
    new Worker<EmailClassifyPayload>(
      QUEUE_NAMES.EMAIL_CLASSIFY,
      async (job: Job<EmailClassifyPayload>) => {
        const { emailId } = job.data;
        log.info({ jobId: job.id, emailId }, 'Processing email-classify job');

        const email = await prisma.email.findUnique({ where: { id: emailId } });
        if (!email) throw new Error(`Email ${emailId} not found`);

        const result = await pipeline.classifyEmail(emailId, {
          subject: email.subject ?? '',
          bodyText: email.bodyText ?? '',
        });

        return { label: result.label, confidence: result.confidence };
      },
      {
        connection,
        concurrency: 5,
      },
    ),
  );

  // --- Email Extract Worker ---
  workers.push(
    new Worker<EmailExtractPayload>(
      QUEUE_NAMES.EMAIL_EXTRACT,
      async (job: Job<EmailExtractPayload>) => {
        const { emailId } = job.data;
        log.info({ jobId: job.id, emailId }, 'Processing email-extract job');

        const email = await prisma.email.findUnique({ where: { id: emailId } });
        if (!email) throw new Error(`Email ${emailId} not found`);

        const entities = await pipeline.extractEntities(emailId, {
          subject: email.subject ?? '',
          bodyText: email.bodyText ?? '',
        });

        return { emailId, entityCount: Object.keys(entities).length };
      },
      {
        connection,
        concurrency: 5,
      },
    ),
  );

  // --- Email CRM Match Worker ---
  workers.push(
    new Worker<EmailCrmMatchPayload>(
      QUEUE_NAMES.EMAIL_CRM_MATCH,
      async (job: Job<EmailCrmMatchPayload>) => {
        const { emailId } = job.data;
        log.info({ jobId: job.id, emailId }, 'Processing email-crm-match job');

        const entities = await prisma.extractedEntity.findMany({
          where: { emailId },
        });

        // Reconstruct ExtractedEntities from stored records
        // This is a simplified reconstruction
        const email = await prisma.email.findUnique({ where: { id: emailId } });

        const result = await pipeline.matchCrm(emailId, {
          sender: {
            email: email?.senderEmail ?? '',
            fullName: email?.senderName ?? null,
            position: null,
            companyName: null,
          },
          contacts: {
            phones: [],
            cityPhone: null,
            mobilePhone: null,
            inn: entities.find((e) => e.fieldName === 'inn')?.fieldValue ?? null,
            kpp: null,
            ogrn: null,
            website: null,
          },
          articles: [],
          signature: null,
          confidence: 0.5,
        });

        return { clientId: result.clientId, matchMethod: result.matchMethod };
      },
      {
        connection,
        concurrency: 3,
      },
    ),
  );

  // --- Email Sync Worker ---
  workers.push(
    new Worker<EmailSyncPayload>(
      QUEUE_NAMES.EMAIL_SYNC,
      async (job: Job<EmailSyncPayload>) => {
        const { emailId, approvedBy } = job.data;
        log.info({ jobId: job.id, emailId, approvedBy }, 'Processing email-sync job');

        // Mark email as synced
        await prisma.email.update({
          where: { id: emailId },
          data: { status: 'synced' },
        });

        await prisma.auditLog.create({
          data: {
            emailId,
            userId: approvedBy,
            action: 'synced_to_crm',
            details: { syncedAt: new Date().toISOString() },
          },
        });

        return { emailId, synced: true };
      },
      {
        connection,
        concurrency: 3,
      },
    ),
  );

  // --- Attachment Process Worker ---
  workers.push(
    new Worker<AttachmentProcessPayload>(
      QUEUE_NAMES.ATTACHMENT_PROCESS,
      async (job: Job<AttachmentProcessPayload>) => {
        const { attachmentId, emailId } = job.data;
        log.info({ jobId: job.id, attachmentId, emailId }, 'Processing attachment');

        const attachment = await prisma.attachment.findUnique({
          where: { id: attachmentId },
        });

        if (!attachment) throw new Error(`Attachment ${attachmentId} not found`);

        const { AttachmentProcessor } = await import('../services/attachment-processor.js');
        const processor = new AttachmentProcessor(log);
        const result = await processor.process({
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          storagePath: attachment.storagePath,
        });

        await prisma.attachment.update({
          where: { id: attachmentId },
          data: {
            category: result.category,
            extractedText: result.extractedText?.slice(0, 50000),
            isQuarantined: result.isQuarantined,
          },
        });

        return { attachmentId, category: result.category };
      },
      {
        connection,
        concurrency: 3,
      },
    ),
  );

  log.info({ workerCount: workers.length }, 'All queue workers created');
  return workers;
}
