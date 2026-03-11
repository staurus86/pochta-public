import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';
import {
  getRedisConnection,
  QUEUE_NAMES,
  enqueue,
  moveToDlq,
} from '../lib/queue-definitions.js';

const log = createChildLogger({ module: 'email-crm-match-worker' });
const prisma = new PrismaClient();

interface EmailCrmMatchJobData {
  emailId: string;
  category: string;
}

interface MatchResult {
  matched: boolean;
  clientId?: string;
  contactId?: string;
  matchMethod?: 'inn' | 'company_name' | 'contact_email' | 'domain';
  confidence: number;
  mopId?: string;
  mozId?: string;
}

async function getExtractedEntities(emailId: string): Promise<Map<string, string[]>> {
  const entities = await prisma.extractedEntity.findMany({
    where: { emailId },
  });

  const map = new Map<string, string[]>();
  for (const e of entities) {
    const values = map.get(e.entityType) ?? [];
    values.push(e.value);
    map.set(e.entityType, values);
  }
  return map;
}

async function matchByInn(innValues: string[]): Promise<MatchResult | null> {
  for (const inn of innValues) {
    const client = await prisma.client?.findFirst?.({
      where: { inn },
      include: { assignedMop: true, assignedMoz: true },
    }).catch(() => null);

    if (client) {
      return {
        matched: true,
        clientId: client.id,
        matchMethod: 'inn',
        confidence: 0.95,
        mopId: client.assignedMop?.id ?? client.mopId,
        mozId: client.assignedMoz?.id ?? client.mozId,
      };
    }
  }
  return null;
}

async function matchByCompanyName(companyNames: string[]): Promise<MatchResult | null> {
  for (const name of companyNames) {
    // Fuzzy search using ILIKE
    const clients = await prisma.client?.findMany?.({
      where: {
        OR: [
          { companyName: { contains: name, mode: 'insensitive' } },
          { shortName: { contains: name, mode: 'insensitive' } },
        ],
      },
      include: { assignedMop: true, assignedMoz: true },
      take: 5,
    }).catch(() => []);

    if (clients && clients.length === 1) {
      const client = clients[0];
      return {
        matched: true,
        clientId: client.id,
        matchMethod: 'company_name',
        confidence: 0.8,
        mopId: client.assignedMop?.id ?? client.mopId,
        mozId: client.assignedMoz?.id ?? client.mozId,
      };
    }
    if (clients && clients.length > 1) {
      // Ambiguous match - pick best but lower confidence
      const client = clients[0];
      return {
        matched: true,
        clientId: client.id,
        matchMethod: 'company_name',
        confidence: 0.5,
        mopId: client.assignedMop?.id ?? client.mopId,
        mozId: client.assignedMoz?.id ?? client.mozId,
      };
    }
  }
  return null;
}

async function matchByContactEmail(emailAddresses: string[]): Promise<MatchResult | null> {
  for (const email of emailAddresses) {
    const contact = await prisma.clientContact?.findFirst?.({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: {
        client: { include: { assignedMop: true, assignedMoz: true } },
      },
    }).catch(() => null);

    if (contact?.client) {
      return {
        matched: true,
        clientId: contact.client.id,
        contactId: contact.id,
        matchMethod: 'contact_email',
        confidence: 0.9,
        mopId: contact.client.assignedMop?.id ?? contact.client.mopId,
        mozId: contact.client.assignedMoz?.id ?? contact.client.mozId,
      };
    }
  }
  return null;
}

async function matchByDomain(domains: string[]): Promise<MatchResult | null> {
  for (const domain of domains) {
    const clients = await prisma.client?.findMany?.({
      where: {
        OR: [
          { domain: { equals: domain, mode: 'insensitive' } },
          { website: { contains: domain, mode: 'insensitive' } },
        ],
      },
      include: { assignedMop: true, assignedMoz: true },
      take: 5,
    }).catch(() => []);

    if (clients && clients.length === 1) {
      const client = clients[0];
      return {
        matched: true,
        clientId: client.id,
        matchMethod: 'domain',
        confidence: 0.75,
        mopId: client.assignedMop?.id ?? client.mopId,
        mozId: client.assignedMoz?.id ?? client.mozId,
      };
    }
  }
  return null;
}

function hasRequiredRequisites(entities: Map<string, string[]>): boolean {
  const hasInn = (entities.get('inn') ?? []).length > 0;
  const hasCompany = (entities.get('company') ?? []).length > 0;
  const hasContact = (entities.get('email') ?? []).length > 0 || (entities.get('phone') ?? []).length > 0;
  return hasInn && hasCompany && hasContact;
}

function shouldAutoSync(result: MatchResult, processingMode: string): boolean {
  if (processingMode === 'manual') return false;
  if (processingMode === 'auto') return result.confidence >= config.crmMatch.autoSyncConfidenceThreshold;
  // semi-auto: only auto-sync for high-confidence matches
  return result.confidence >= 0.9;
}

async function processJob(job: Job<EmailCrmMatchJobData>): Promise<void> {
  const { data } = job;
  const jobLog = log.child({ jobId: job.id, emailId: data.emailId });

  jobLog.info('Starting CRM match');

  const email = await prisma.email.findUniqueOrThrow({
    where: { id: data.emailId },
  });

  const entities = await getExtractedEntities(data.emailId);
  const fromAddress = email.fromAddress ?? '';

  // Add sender email to contact emails for matching
  const contactEmails = entities.get('email') ?? [];
  if (fromAddress && !contactEmails.includes(fromAddress)) {
    contactEmails.unshift(fromAddress);
    entities.set('email', contactEmails);
  }

  // Matching cascade: INN -> company name -> contact email -> domain
  let matchResult: MatchResult | null = null;

  // 1. Match by INN (highest confidence)
  const innValues = entities.get('inn') ?? [];
  if (innValues.length > 0) {
    matchResult = await matchByInn(innValues);
    if (matchResult) jobLog.debug({ method: 'inn' }, 'Matched by INN');
  }

  // 2. Match by company name
  if (!matchResult) {
    const companyNames = entities.get('company') ?? [];
    if (companyNames.length > 0) {
      matchResult = await matchByCompanyName(companyNames);
      if (matchResult) jobLog.debug({ method: 'company_name' }, 'Matched by company name');
    }
  }

  // 3. Match by contact email
  if (!matchResult) {
    matchResult = await matchByContactEmail(contactEmails);
    if (matchResult) jobLog.debug({ method: 'contact_email' }, 'Matched by contact email');
  }

  // 4. Match by domain
  if (!matchResult) {
    const domains = entities.get('domain') ?? [];
    if (domains.length > 0) {
      matchResult = await matchByDomain(domains);
      if (matchResult) jobLog.debug({ method: 'domain' }, 'Matched by domain');
    }
  }

  // Store CRM match record
  await prisma.crmMatch.create({
    data: {
      emailId: data.emailId,
      matched: matchResult?.matched ?? false,
      clientId: matchResult?.clientId ?? null,
      contactId: matchResult?.contactId ?? null,
      matchMethod: matchResult?.matchMethod ?? null,
      confidence: matchResult?.confidence ?? 0,
      mopId: matchResult?.mopId ?? null,
      mozId: matchResult?.mozId ?? null,
    },
  });

  // Determine next status
  let newStatus: string;

  if (matchResult?.matched) {
    if (shouldAutoSync(matchResult, config.crmMatch.processingMode)) {
      newStatus = 'ready_to_sync';
    } else {
      newStatus = 'awaiting_review';
    }
  } else {
    // No match found
    if (!hasRequiredRequisites(entities)) {
      newStatus = 'awaiting_client_details';
    } else {
      // Has requisites but no match - could create draft client
      try {
        const companyNames = entities.get('company') ?? [];
        const innValues = entities.get('inn') ?? [];

        if (companyNames.length > 0) {
          const draftClient = await prisma.client?.create?.({
            data: {
              companyName: companyNames[0],
              inn: innValues[0] ?? null,
              domain: (entities.get('domain') ?? [])[0] ?? null,
              website: (entities.get('website') ?? [])[0] ?? null,
              isDraft: true,
              source: 'email-auto',
            },
          }).catch(() => null);

          if (draftClient) {
            // Update match record with draft client
            await prisma.crmMatch.updateMany({
              where: { emailId: data.emailId },
              data: { clientId: draftClient.id, matched: true },
            });

            matchResult = {
              matched: true,
              clientId: draftClient.id,
              matchMethod: 'company_name',
              confidence: 0.4,
            };
          }
        }
      } catch (err) {
        jobLog.warn({ err }, 'Failed to create draft client');
      }

      newStatus = 'awaiting_review';
    }
  }

  // Update email status
  await prisma.email.update({
    where: { id: data.emailId },
    data: { status: newStatus },
  });

  // If ready to sync, enqueue
  if (newStatus === 'ready_to_sync') {
    await enqueue(QUEUE_NAMES.EMAIL_SYNC, 'sync-email', {
      emailId: data.emailId,
      clientId: matchResult!.clientId,
      contactId: matchResult!.contactId,
      mopId: matchResult!.mopId,
      mozId: matchResult!.mozId,
      category: data.category,
    });
  }

  jobLog.info(
    {
      matched: matchResult?.matched ?? false,
      method: matchResult?.matchMethod,
      confidence: matchResult?.confidence,
      newStatus,
    },
    'CRM match completed',
  );
}

export function createEmailCrmMatchWorker(): Worker {
  const worker = new Worker<EmailCrmMatchJobData>(
    QUEUE_NAMES.EMAIL_CRM_MATCH,
    async (job) => {
      await processJob(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: config.workers.emailCrmMatchConcurrency,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'CRM match job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'CRM match job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      moveToDlq(QUEUE_NAMES.EMAIL_CRM_MATCH, job.data, err).catch((dlqErr) => {
        log.error({ dlqErr }, 'Failed to move job to DLQ');
      });
    }
  });

  worker.on('error', (err) => {
    log.error({ err }, 'CRM match worker error');
  });

  log.info('CRM match worker started');
  return worker;
}
