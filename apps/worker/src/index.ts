import { Worker } from 'bullmq';
import { config } from './config.js';
import { logger, createChildLogger } from './lib/logger.js';
import { closeAllQueues } from './lib/queue-definitions.js';
import { createEmailFetchWorker } from './workers/email-fetch.worker.js';
import { createEmailParseWorker } from './workers/email-parse.worker.js';
import { createEmailClassifyWorker } from './workers/email-classify.worker.js';
import { createEmailExtractWorker } from './workers/email-extract.worker.js';
import { createEmailCrmMatchWorker } from './workers/email-crm-match.worker.js';
import { createEmailSyncWorker } from './workers/email-sync.worker.js';
import { createAttachmentProcessWorker } from './workers/attachment-process.worker.js';

const log = createChildLogger({ module: 'main' });

const workers: Worker[] = [];

async function startWorkers(): Promise<void> {
  log.info('Starting all workers...');

  workers.push(
    createEmailFetchWorker(),
    createEmailParseWorker(),
    createEmailClassifyWorker(),
    createEmailExtractWorker(),
    createEmailCrmMatchWorker(),
    createEmailSyncWorker(),
    createAttachmentProcessWorker(),
  );

  log.info({ workerCount: workers.length }, 'All workers started');
}

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'Received shutdown signal, gracefully stopping workers...');

  const closeTimeout = setTimeout(() => {
    log.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 30_000);

  try {
    // Close all workers
    await Promise.all(
      workers.map(async (worker) => {
        try {
          await worker.close();
        } catch (err) {
          log.error({ err, workerName: worker.name }, 'Error closing worker');
        }
      }),
    );

    // Close all queues
    await closeAllQueues();

    clearTimeout(closeTimeout);
    log.info('All workers stopped gracefully');
    process.exit(0);
  } catch (err) {
    clearTimeout(closeTimeout);
    log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  log.fatal({ reason }, 'Unhandled rejection');
  shutdown('unhandledRejection').catch(() => process.exit(1));
});

// Start
startWorkers().catch((err) => {
  log.fatal({ err }, 'Failed to start workers');
  process.exit(1);
});
