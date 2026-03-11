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

const log = createChildLogger({ module: 'email-extract-worker' });
const prisma = new PrismaClient();

interface EmailExtractJobData {
  emailId: string;
  category: string;
}

interface ExtractedField {
  type: string;
  value: string;
  confidence: number;
  source: 'regex' | 'template' | 'llm';
  position?: { start: number; end: number };
}

// --- Regex patterns for entity extraction ---

const PATTERNS: Record<string, RegExp[]> = {
  email: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g],
  phone: [
    /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g,
    /\+\d{1,3}[\s(-]*\d{2,4}[\s)-]*\d{3,4}[\s-]*\d{2,4}/g,
  ],
  inn: [
    /\bИНН[\s:]*(\d{10}|\d{12})\b/gi,
    /\bINN[\s:]*(\d{10}|\d{12})\b/gi,
  ],
  kpp: [
    /\bКПП[\s:]*(\d{9})\b/gi,
    /\bKPP[\s:]*(\d{9})\b/gi,
  ],
  ogrn: [
    /\bОГРН[\s:]*(\d{13}|\d{15})\b/gi,
    /\bOGRN[\s:]*(\d{13}|\d{15})\b/gi,
  ],
  website: [
    /\bhttps?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
    /\bwww\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  ],
  company: [
    /(?:ООО|ОАО|ЗАО|ПАО|АО|ИП)\s*[«"]([^»"]+)[»"]/g,
    /(?:ООО|ОАО|ЗАО|ПАО|АО|ИП)\s+"([^"]+)"/g,
    /(?:LLC|Inc|Corp|Ltd|GmbH)\s+["']?([^"'\n,]+)["']?/gi,
  ],
  person_name: [
    // Russian full name patterns
    /(?:(?:Директор|Менеджер|Руководитель|Специалист|Инженер)\s*[-:])?\s*([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/g,
  ],
  position: [
    /(?:должность|position)[\s:]*([^\n,;]+)/gi,
    /(?:Генеральный директор|Коммерческий директор|Менеджер по (?:продажам|закупкам)|Инженер|Специалист|Руководитель отдела[^\n,;]*)/gi,
  ],
  brand: [
    /(?:бренд|марка|brand|manufacturer)[\s:]*([^\n,;]+)/gi,
  ],
  article: [
    /(?:артикул|арт\.|article|SKU|part\s*(?:number|no|#))[\s.:]*([A-Za-z0-9][\w.-]{2,})/gi,
  ],
  quantity: [
    /(\d+(?:[.,]\d+)?)\s*(?:шт|штук|ед|единиц|pcs|pieces|units|комплект)/gi,
    /(?:количество|qty|quantity)[\s:]*(\d+(?:[.,]\d+)?)/gi,
  ],
  unit: [
    /\d+\s*(шт|штук|ед|единиц|pcs|pieces|units|м|метр|мм|кг|тонн|л|литр|м2|м3|п\.м|комплект)/gi,
  ],
};

function extractWithRegex(text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];

  for (const [type, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const value = match[1] ?? match[0];
        const trimmed = value.trim();
        if (!trimmed) continue;

        // Avoid duplicate values for same type
        if (fields.some((f) => f.type === type && f.value === trimmed)) continue;

        fields.push({
          type,
          value: trimmed,
          confidence: 0.7,
          source: 'regex',
          position: { start: match.index, end: match.index + match[0].length },
        });
      }
    }
  }

  return fields;
}

function extractDomain(text: string, fromAddress: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const domain = fromAddress.split('@')[1];
  if (domain && !domain.match(/^(gmail|yahoo|mail|yandex|hotmail|outlook)\./i)) {
    fields.push({
      type: 'domain',
      value: domain,
      confidence: 0.9,
      source: 'regex',
    });
  }
  return fields;
}

async function extractWithTemplate(
  emailId: string,
  text: string,
  fromAddress: string,
): Promise<ExtractedField[]> {
  const fields: ExtractedField[] = [];

  try {
    // Look for matching template rules based on sender domain
    const domain = fromAddress.split('@')[1];
    const templateRules = await prisma.templateRule?.findMany?.({
      where: {
        OR: [
          { senderDomain: domain },
          { senderAddress: fromAddress },
        ],
        isActive: true,
      },
    }).catch(() => []);

    if (!templateRules || templateRules.length === 0) return fields;

    for (const rule of templateRules) {
      const rulePatterns = rule.extractionPatterns as Record<string, string> | null;
      if (!rulePatterns) continue;

      for (const [fieldType, patternStr] of Object.entries(rulePatterns)) {
        try {
          const regex = new RegExp(patternStr, 'gi');
          let match: RegExpExecArray | null;
          while ((match = regex.exec(text)) !== null) {
            const value = (match[1] ?? match[0]).trim();
            if (value) {
              fields.push({
                type: fieldType,
                value,
                confidence: 0.85,
                source: 'template',
              });
            }
          }
        } catch {
          log.warn({ fieldType, patternStr }, 'Invalid template regex pattern');
        }
      }
    }
  } catch (err) {
    log.warn({ err }, 'Template extraction failed');
  }

  return fields;
}

async function extractWithLlm(
  subject: string,
  body: string,
  existingFields: ExtractedField[],
): Promise<ExtractedField[]> {
  const existingSummary = existingFields
    .map((f) => `${f.type}: ${f.value}`)
    .join('\n');

  const prompt = `Extract business entities from this email. Return JSON array of objects with fields: type, value, confidence.

Types to extract: company, person_name, position, email, phone, inn, kpp, ogrn, website, domain, brand, article, quantity, unit

Already extracted:
${existingSummary}

Subject: ${subject}
Body (first 3000 chars): ${body.slice(0, 3000)}

Return ONLY new entities not already listed. Respond with JSON array: [{"type": "...", "value": "...", "confidence": 0.0-1.0}]`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.llm.timeoutMs);

    const response = await fetch(`${config.llm.apiUrl}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.llm.apiKey ? { Authorization: `Bearer ${config.llm.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.llm.model,
        prompt,
        stream: false,
        format: 'json',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`LLM API returned ${response.status}`);
    }

    const result = await response.json() as { response: string };
    const parsed = JSON.parse(result.response);
    const entities = Array.isArray(parsed) ? parsed : parsed.entities ?? [];

    return entities.map((e: { type: string; value: string; confidence: number }) => ({
      type: e.type,
      value: String(e.value).trim(),
      confidence: Math.min(Math.max(e.confidence ?? 0.6, 0), 1),
      source: 'llm' as const,
    }));
  } catch (err) {
    log.warn({ err }, 'LLM extraction failed');
    return [];
  }
}

function deduplicateFields(fields: ExtractedField[]): ExtractedField[] {
  const seen = new Map<string, ExtractedField>();

  for (const field of fields) {
    const key = `${field.type}:${field.value.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || field.confidence > existing.confidence) {
      seen.set(key, field);
    }
  }

  return Array.from(seen.values());
}

async function processJob(job: Job<EmailExtractJobData>): Promise<void> {
  const { data } = job;
  const jobLog = log.child({ jobId: job.id, emailId: data.emailId });

  jobLog.info('Starting entity extraction');

  const email = await prisma.email.findUniqueOrThrow({
    where: { id: data.emailId },
    include: { emailBody: true },
  });

  const subject = email.subject ?? '';
  const body = email.emailBody?.textBody ?? '';
  const fromAddress = email.fromAddress ?? '';
  const fullText = `${subject}\n${body}`;

  // Step 1: Regex extraction
  let fields = extractWithRegex(fullText);

  // Step 2: Domain extraction from sender
  fields.push(...extractDomain(fullText, fromAddress));

  // Step 3: Template-based extraction
  const templateFields = await extractWithTemplate(data.emailId, fullText, fromAddress);
  fields.push(...templateFields);

  // Step 4: LLM extraction if fields seem incomplete
  const hasCompany = fields.some((f) => f.type === 'company');
  const hasName = fields.some((f) => f.type === 'person_name');
  const hasContact = fields.some((f) => f.type === 'email' || f.type === 'phone');

  if (!hasCompany || !hasName || !hasContact) {
    const llmFields = await extractWithLlm(subject, body, fields);
    fields.push(...llmFields);
  }

  // Deduplicate
  fields = deduplicateFields(fields);

  // Store extracted entities
  for (const field of fields) {
    await prisma.extractedEntity.create({
      data: {
        emailId: data.emailId,
        entityType: field.type,
        value: field.value,
        confidence: field.confidence,
        source: field.source,
        position: field.position as any ?? null,
      },
    });
  }

  // Update status
  await prisma.email.update({
    where: { id: data.emailId },
    data: { status: 'entities_extracted' },
  });

  // Enqueue to CRM match
  await enqueue(QUEUE_NAMES.EMAIL_CRM_MATCH, 'crm-match', {
    emailId: data.emailId,
    category: data.category,
  });

  jobLog.info({ entityCount: fields.length }, 'Entity extraction completed');
}

export function createEmailExtractWorker(): Worker {
  const worker = new Worker<EmailExtractJobData>(
    QUEUE_NAMES.EMAIL_EXTRACT,
    async (job) => {
      await processJob(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: config.workers.emailExtractConcurrency,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Email extract job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Email extract job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      moveToDlq(QUEUE_NAMES.EMAIL_EXTRACT, job.data, err).catch((dlqErr) => {
        log.error({ dlqErr }, 'Failed to move job to DLQ');
      });
    }
  });

  worker.on('error', (err) => {
    log.error({ err }, 'Email extract worker error');
  });

  log.info('Email extract worker started');
  return worker;
}
