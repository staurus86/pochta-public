import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';
import {
  getRedisConnection,
  QUEUE_NAMES,
  moveToDlq,
} from '../lib/queue-definitions.js';

const log = createChildLogger({ module: 'email-sync-worker' });
const prisma = new PrismaClient();

interface EmailSyncJobData {
  emailId: string;
  clientId?: string;
  contactId?: string;
  mopId?: string;
  mozId?: string;
  category: string;
}

async function processJob(job: Job<EmailSyncJobData>): Promise<void> {
  const { data } = job;
  const jobLog = log.child({ jobId: job.id, emailId: data.emailId });

  jobLog.info({ dryRun: config.sync.dryRun }, 'Starting CRM sync');

  const email = await prisma.email.findUniqueOrThrow({
    where: { id: data.emailId },
    include: {
      emailBody: true,
      extractedEntities: true,
      emailClassification: true,
      crmMatch: true,
    },
  });

  const entities = email.extractedEntities ?? [];
  const entitiesByType = new Map<string, string[]>();
  for (const e of entities) {
    const values = entitiesByType.get(e.entityType) ?? [];
    values.push(e.value);
    entitiesByType.set(e.entityType, values);
  }

  if (config.sync.dryRun) {
    jobLog.info(
      {
        clientId: data.clientId,
        category: data.category,
        entities: Object.fromEntries(entitiesByType),
      },
      'DRY RUN: Would sync to CRM',
    );

    await prisma.auditLog.create({
      data: {
        emailId: data.emailId,
        action: 'crm_sync_dry_run',
        details: {
          clientId: data.clientId,
          contactId: data.contactId,
          category: data.category,
          dryRun: true,
        } as any,
        performedBy: 'system',
      },
    });

    await prisma.email.update({
      where: { id: data.emailId },
      data: { status: 'synced' },
    });

    return;
  }

  // Use a transaction for CRM operations
  await prisma.$transaction(async (tx) => {
    // 1. Create or update Client
    let clientId = data.clientId;
    if (!clientId) {
      const companyName = (entitiesByType.get('company') ?? [])[0] ?? 'Unknown Company';
      const client = await tx.client.create({
        data: {
          companyName,
          inn: (entitiesByType.get('inn') ?? [])[0] ?? null,
          kpp: (entitiesByType.get('kpp') ?? [])[0] ?? null,
          ogrn: (entitiesByType.get('ogrn') ?? [])[0] ?? null,
          domain: (entitiesByType.get('domain') ?? [])[0] ?? null,
          website: (entitiesByType.get('website') ?? [])[0] ?? null,
          source: 'email-auto',
          mopId: data.mopId ?? null,
          mozId: data.mozId ?? null,
        },
      });
      clientId = client.id;
      jobLog.info({ clientId }, 'Created new client');
    } else {
      // Update existing client with any new information
      const updateData: Record<string, unknown> = {};
      const inn = (entitiesByType.get('inn') ?? [])[0];
      const kpp = (entitiesByType.get('kpp') ?? [])[0];
      const ogrn = (entitiesByType.get('ogrn') ?? [])[0];
      const website = (entitiesByType.get('website') ?? [])[0];

      if (inn) updateData.inn = inn;
      if (kpp) updateData.kpp = kpp;
      if (ogrn) updateData.ogrn = ogrn;
      if (website) updateData.website = website;

      if (Object.keys(updateData).length > 0) {
        await tx.client.update({
          where: { id: clientId },
          data: updateData,
        });
        jobLog.debug({ clientId, fields: Object.keys(updateData) }, 'Updated client');
      }
    }

    // 2. Create ClientContact if we have contact info
    let contactId = data.contactId;
    if (!contactId) {
      const contactName = (entitiesByType.get('person_name') ?? [])[0];
      const contactEmail = email.fromAddress ?? (entitiesByType.get('email') ?? [])[0];
      const contactPhone = (entitiesByType.get('phone') ?? [])[0];
      const contactPosition = (entitiesByType.get('position') ?? [])[0];

      if (contactEmail || contactPhone) {
        // Check if contact already exists
        const existingContact = await tx.clientContact.findFirst({
          where: {
            clientId,
            OR: [
              ...(contactEmail ? [{ email: contactEmail }] : []),
              ...(contactPhone ? [{ phone: contactPhone }] : []),
            ],
          },
        }).catch(() => null);

        if (existingContact) {
          contactId = existingContact.id;
          // Update with new info
          const contactUpdate: Record<string, unknown> = {};
          if (contactName && !existingContact.name) contactUpdate.name = contactName;
          if (contactPosition && !existingContact.position) contactUpdate.position = contactPosition;
          if (Object.keys(contactUpdate).length > 0) {
            await tx.clientContact.update({
              where: { id: contactId },
              data: contactUpdate,
            });
          }
        } else {
          const contact = await tx.clientContact.create({
            data: {
              clientId,
              name: contactName ?? null,
              email: contactEmail ?? null,
              phone: contactPhone ?? null,
              position: contactPosition ?? null,
              source: 'email-auto',
            },
          });
          contactId = contact.id;
          jobLog.info({ contactId }, 'Created new client contact');
        }
      }
    }

    // 3. Create Request if it's an inquiry or order
    if (data.category === 'inquiry' || data.category === 'order') {
      const articles = entitiesByType.get('article') ?? [];
      const quantities = entitiesByType.get('quantity') ?? [];
      const brands = entitiesByType.get('brand') ?? [];
      const units = entitiesByType.get('unit') ?? [];

      const request = await tx.request.create({
        data: {
          emailId: data.emailId,
          clientId,
          contactId: contactId ?? null,
          type: data.category,
          subject: email.subject ?? 'Email request',
          status: 'new',
          mopId: data.mopId ?? null,
          mozId: data.mozId ?? null,
          source: 'email',
        },
      });

      // Create RequestItems from extracted articles
      if (articles.length > 0) {
        const items = articles.map((article, i) => ({
          requestId: request.id,
          article,
          brand: brands[i] ?? brands[0] ?? null,
          quantity: quantities[i] ? parseFloat(quantities[i].replace(',', '.')) : null,
          unit: units[i] ?? units[0] ?? null,
        }));

        await tx.requestItem.createMany({ data: items });
        jobLog.debug({ itemCount: items.length }, 'Created request items');
      }

      jobLog.info({ requestId: request.id }, 'Created request');
    }

    // 4. Assign MOP/MOZ if not already assigned
    if (data.mopId || data.mozId) {
      await tx.client.update({
        where: { id: clientId },
        data: {
          ...(data.mopId ? { mopId: data.mopId } : {}),
          ...(data.mozId ? { mozId: data.mozId } : {}),
        },
      });
    }

    // 5. Create AuditLog entry
    await tx.auditLog.create({
      data: {
        emailId: data.emailId,
        action: 'crm_sync',
        details: {
          clientId,
          contactId,
          category: data.category,
          mopId: data.mopId,
          mozId: data.mozId,
          entitiesCount: entities.length,
        } as any,
        performedBy: 'system',
      },
    });

    // 6. Update email status
    await tx.email.update({
      where: { id: data.emailId },
      data: {
        status: 'synced',
        clientId,
        syncedAt: new Date(),
      },
    });
  });

  jobLog.info('CRM sync completed');
}

export function createEmailSyncWorker(): Worker {
  const worker = new Worker<EmailSyncJobData>(
    QUEUE_NAMES.EMAIL_SYNC,
    async (job) => {
      await processJob(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: config.workers.emailSyncConcurrency,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Email sync job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Email sync job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      moveToDlq(QUEUE_NAMES.EMAIL_SYNC, job.data, err).catch((dlqErr) => {
        log.error({ dlqErr }, 'Failed to move job to DLQ');
      });
    }
  });

  worker.on('error', (err) => {
    log.error({ err }, 'Email sync worker error');
  });

  log.info('Email sync worker started');
  return worker;
}
