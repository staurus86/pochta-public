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

const log = createChildLogger({ module: 'email-classify-worker' });
const prisma = new PrismaClient();

interface EmailClassifyJobData {
  emailId: string;
}

type Classification =
  | 'inquiry'
  | 'order'
  | 'spam'
  | 'newsletter'
  | 'auto-reply'
  | 'internal'
  | 'complaint'
  | 'other';

interface ClassificationResult {
  category: Classification;
  confidence: number;
  method: 'rule-based' | 'llm' | 'hybrid';
  details: Record<string, unknown>;
}

// Spam patterns
const SPAM_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bОтписаться\b/i,
  /\bviagra\b/i,
  /\bcasino\b/i,
  /\blottery\b/i,
  /\bwin\s+(?:a\s+)?(?:free|prize)\b/i,
  /\bclick\s+here\s+now\b/i,
  /\bнигерийск/i,
  /\bвыигр(?:ал|ыш)\b/i,
];

const SPAM_DOMAINS = [
  'spam.com',
  'marketing-blast.com',
  'bulk-sender.net',
];

// Auto-reply patterns
const AUTO_REPLY_PATTERNS = [
  /\bauto[\s-]?reply\b/i,
  /\bout[\s-]?of[\s-]?office\b/i,
  /\bautomatically generated\b/i,
  /\bавтоматический ответ\b/i,
  /\bвне офиса\b/i,
  /\bmailer[\s-]?daemon\b/i,
  /\bdelivery[\s-]?(?:status|failure|notification)\b/i,
];

// Newsletter patterns
const NEWSLETTER_PATTERNS = [
  /\bnewsletter\b/i,
  /\bрассылк[аи]\b/i,
  /\bList-Unsubscribe\b/i,
  /\bdaily\s+digest\b/i,
  /\bweekly\s+update\b/i,
];

// Inquiry patterns (Russian business context)
const INQUIRY_PATTERNS = [
  /\b(?:запрос|заявк[аи]|коммерческ(?:ое|ого)\s+предложени[еяй])\b/i,
  /\bКП\b/,
  /\b(?:прошу|просим)\s+(?:выслать|направить|предоставить|прислать)\b/i,
  /\b(?:цен[аыу]|прайс|стоимост[ьи]|расценк[иа])\b/i,
  /\b(?:наличи[еи]|остат(?:ок|ки)|склад)\b/i,
  /\b(?:request\s+for\s+(?:quote|proposal|information))\b/i,
  /\bRFQ\b/i,
  /\bRFP\b/i,
];

// Order patterns
const ORDER_PATTERNS = [
  /\b(?:заказ|закупк[аи]|поставк[аи])\b/i,
  /\b(?:purchase\s+order|PO\s*#?\d+)\b/i,
  /\bсчёт|счет(?:\s+на\s+оплату)?\b/i,
  /\b(?:оплат[аиу]|предоплат[аиу])\b/i,
  /\b(?:договор|контракт)\b/i,
];

// Complaint patterns
const COMPLAINT_PATTERNS = [
  /\b(?:рекламаци[яю]|претензи[яюей]|жалоб[аыу])\b/i,
  /\b(?:брак|дефект|несоответстви)\b/i,
  /\b(?:complaint|defect|damaged)\b/i,
  /\b(?:вернуть|возврат)\b/i,
];

function runRuleClassification(
  subject: string,
  body: string,
  fromAddress: string,
): ClassificationResult {
  const text = `${subject} ${body}`;
  const domain = fromAddress.split('@')[1]?.toLowerCase() ?? '';

  // Check spam first
  const spamScore = SPAM_PATTERNS.reduce((score, p) => score + (p.test(text) ? 0.3 : 0), 0);
  if (SPAM_DOMAINS.includes(domain)) {
    return { category: 'spam', confidence: 0.95, method: 'rule-based', details: { domain } };
  }
  if (spamScore >= 0.6) {
    return {
      category: 'spam',
      confidence: Math.min(spamScore, 1),
      method: 'rule-based',
      details: { spamScore },
    };
  }

  // Check auto-reply
  if (AUTO_REPLY_PATTERNS.some((p) => p.test(text) || p.test(subject))) {
    return { category: 'auto-reply', confidence: 0.9, method: 'rule-based', details: {} };
  }

  // Check newsletter
  if (NEWSLETTER_PATTERNS.some((p) => p.test(text))) {
    return { category: 'newsletter', confidence: 0.8, method: 'rule-based', details: {} };
  }

  // Check complaint
  const complaintMatches = COMPLAINT_PATTERNS.filter((p) => p.test(text)).length;
  if (complaintMatches >= 2) {
    return {
      category: 'complaint',
      confidence: 0.7 + complaintMatches * 0.05,
      method: 'rule-based',
      details: { complaintMatches },
    };
  }

  // Check order
  const orderMatches = ORDER_PATTERNS.filter((p) => p.test(text)).length;
  if (orderMatches >= 2) {
    return {
      category: 'order',
      confidence: 0.6 + orderMatches * 0.1,
      method: 'rule-based',
      details: { orderMatches },
    };
  }

  // Check inquiry
  const inquiryMatches = INQUIRY_PATTERNS.filter((p) => p.test(text)).length;
  if (inquiryMatches >= 1) {
    return {
      category: 'inquiry',
      confidence: 0.5 + inquiryMatches * 0.1,
      method: 'rule-based',
      details: { inquiryMatches },
    };
  }

  // Low confidence fallback
  return { category: 'other', confidence: 0.3, method: 'rule-based', details: {} };
}

async function classifyWithLlm(
  subject: string,
  body: string,
  fromAddress: string,
): Promise<ClassificationResult> {
  const prompt = `Classify the following email into one of these categories: inquiry, order, spam, newsletter, auto-reply, internal, complaint, other.

Subject: ${subject}
From: ${fromAddress}
Body (first 2000 chars): ${body.slice(0, 2000)}

Respond in JSON format: {"category": "...", "confidence": 0.0-1.0, "reasoning": "..."}`;

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

    return {
      category: parsed.category as Classification,
      confidence: Math.min(Math.max(parsed.confidence, 0), 1),
      method: 'llm',
      details: { reasoning: parsed.reasoning },
    };
  } catch (err) {
    log.warn({ err }, 'LLM classification failed, using rule-based fallback');
    throw err;
  }
}

async function processJob(job: Job<EmailClassifyJobData>): Promise<void> {
  const { data } = job;
  const jobLog = log.child({ jobId: job.id, emailId: data.emailId });

  jobLog.info('Starting email classification');

  // Fetch email with body
  const email = await prisma.email.findUniqueOrThrow({
    where: { id: data.emailId },
    include: { emailBody: true },
  });

  const subject = email.subject ?? '';
  const body = email.emailBody?.textBody ?? '';
  const fromAddress = email.fromAddress ?? '';

  // Run rule-based classification
  let result = runRuleClassification(subject, body, fromAddress);

  // If low confidence, try LLM
  if (result.confidence < config.classification.confidenceThreshold) {
    try {
      const llmResult = await classifyWithLlm(subject, body, fromAddress);
      // Use LLM if it's more confident
      if (llmResult.confidence > result.confidence) {
        result = {
          ...llmResult,
          method: 'hybrid',
          details: { ruleResult: result, llmResult: llmResult.details },
        };
      }
    } catch {
      // Keep rule-based result
      jobLog.warn('Falling back to rule-based classification');
    }
  }

  // Store classification
  await prisma.emailClassification.create({
    data: {
      emailId: data.emailId,
      category: result.category,
      confidence: result.confidence,
      method: result.method,
      details: result.details as any,
    },
  });

  // Handle spam: mark as synced and skip further processing
  if (result.category === 'spam' && result.confidence >= config.classification.spamThreshold) {
    await prisma.email.update({
      where: { id: data.emailId },
      data: { status: 'synced' },
    });
    jobLog.info({ category: result.category, confidence: result.confidence }, 'Email classified as spam, skipping');
    return;
  }

  // Update status
  await prisma.email.update({
    where: { id: data.emailId },
    data: { status: 'classified' },
  });

  // Enqueue to extract (skip for auto-replies and newsletters)
  if (result.category !== 'auto-reply' && result.category !== 'newsletter') {
    await enqueue(QUEUE_NAMES.EMAIL_EXTRACT, 'extract-entities', {
      emailId: data.emailId,
      category: result.category,
    });
  } else {
    // Mark as synced since no further processing needed
    await prisma.email.update({
      where: { id: data.emailId },
      data: { status: 'synced' },
    });
  }

  jobLog.info(
    { category: result.category, confidence: result.confidence, method: result.method },
    'Email classification completed',
  );
}

export function createEmailClassifyWorker(): Worker {
  const worker = new Worker<EmailClassifyJobData>(
    QUEUE_NAMES.EMAIL_CLASSIFY,
    async (job) => {
      await processJob(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: config.workers.emailClassifyConcurrency,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Email classify job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Email classify job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      moveToDlq(QUEUE_NAMES.EMAIL_CLASSIFY, job.data, err).catch((dlqErr) => {
        log.error({ dlqErr }, 'Failed to move job to DLQ');
      });
    }
  });

  worker.on('error', (err) => {
    log.error({ err }, 'Email classify worker error');
  });

  log.info('Email classify worker started');
  return worker;
}
