import { Worker, Job } from 'bullmq';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';
import {
  getRedisConnection,
  QUEUE_NAMES,
  enqueue,
  moveToDlq,
} from '../lib/queue-definitions.js';

const log = createChildLogger({ module: 'email-parse-worker' });
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

interface EmailParseJobData {
  emailId: string;
  rawStoragePath: string;
}

// Common quote line indicators
const QUOTE_PATTERNS = [
  /^>+\s?/,
  /^On .+ wrote:$/,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^-{2,}\s*Пересланное сообщение\s*-{2,}$/i,
  /^-{2,}\s*Исходное сообщение\s*-{2,}$/i,
  /^\d{1,2}[./]\d{1,2}[./]\d{2,4}.*(?:wrote|написал|пишет)/i,
  /^From:\s/i,
  /^Sent:\s/i,
  /^От:\s/i,
  /^Отправлено:\s/i,
];

// Signature patterns
const SIGNATURE_PATTERNS = [
  /^--\s*$/,
  /^_{3,}$/,
  /^С уважением[,.]?\s*/i,
  /^Best regards[,.]?\s*/i,
  /^Kind regards[,.]?\s*/i,
  /^Regards[,.]?\s*/i,
  /^Sent from my /i,
  /^Отправлено с /i,
];

function separateQuotedText(text: string): { newContent: string; quotedContent: string } {
  const lines = text.split('\n');
  const newLines: string[] = [];
  const quotedLines: string[] = [];
  let inQuote = false;

  for (const line of lines) {
    if (!inQuote && QUOTE_PATTERNS.some((p) => p.test(line.trim()))) {
      inQuote = true;
    }
    if (inQuote) {
      quotedLines.push(line);
    } else {
      newLines.push(line);
    }
  }

  return {
    newContent: newLines.join('\n').trim(),
    quotedContent: quotedLines.join('\n').trim(),
  };
}

function extractSignature(text: string): { body: string; signature: string } {
  const lines = text.split('\n');
  let signatureStart = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (SIGNATURE_PATTERNS.some((p) => p.test(lines[i].trim()))) {
      signatureStart = i;
      break;
    }
  }

  if (signatureStart === -1 || signatureStart < lines.length * 0.3) {
    // No signature found, or it would be too much of the email
    return { body: text, signature: '' };
  }

  return {
    body: lines.slice(0, signatureStart).join('\n').trim(),
    signature: lines.slice(signatureStart).join('\n').trim(),
  };
}

function detectLanguage(text: string): string {
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) ?? []).length;
  const latinCount = (text.match(/[a-zA-Z]/g) ?? []).length;
  const totalLetters = cyrillicCount + latinCount;

  if (totalLetters === 0) return 'unknown';
  if (cyrillicCount / totalLetters > 0.3) return 'ru';
  return 'en';
}

function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'data', 'cid'],
  });
}

async function storeAttachment(
  attachment: Attachment,
  emailId: string,
  index: number,
): Promise<{ s3Key: string; filename: string; mimeType: string; size: number }> {
  const filename = attachment.filename ?? `attachment-${index}`;
  const s3Key = `attachments/${emailId}/${index}-${filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: s3Key,
      Body: attachment.content,
      ContentType: attachment.contentType,
    }),
  );

  return {
    s3Key,
    filename,
    mimeType: attachment.contentType,
    size: attachment.size,
  };
}

async function processJob(job: Job<EmailParseJobData>): Promise<void> {
  const { data } = job;
  const jobLog = log.child({ jobId: job.id, emailId: data.emailId });

  jobLog.info('Starting email parse');

  // Fetch raw email from S3
  const s3Response = await s3.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: data.rawStoragePath,
    }),
  );

  const rawBody = await s3Response.Body?.transformToByteArray();
  if (!rawBody) {
    throw new Error(`Empty body from S3 for key: ${data.rawStoragePath}`);
  }

  // Parse email
  const parsed: ParsedMail = await simpleParser(Buffer.from(rawBody));

  // Extract and separate body
  const textBody = parsed.text ?? '';
  const htmlBody = parsed.html ? sanitizeBody(parsed.html) : '';

  const { newContent, quotedContent } = separateQuotedText(textBody);
  const { body: mainBody, signature } = extractSignature(newContent);

  const language = detectLanguage(mainBody);

  // Update Email record with parsed headers
  await prisma.email.update({
    where: { id: data.emailId },
    data: {
      subject: parsed.subject ?? null,
      fromAddress: parsed.from?.value?.[0]?.address ?? null,
      fromName: parsed.from?.value?.[0]?.name ?? null,
      toAddresses: parsed.to
        ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
            .flatMap((a) => a.value.map((v) => v.address))
            .filter(Boolean)
        : [],
      ccAddresses: parsed.cc
        ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc])
            .flatMap((a) => a.value.map((v) => v.address))
            .filter(Boolean)
        : [],
      date: parsed.date ?? null,
      inReplyTo: parsed.inReplyTo ?? null,
      references: typeof parsed.references === 'string'
        ? [parsed.references]
        : parsed.references ?? [],
    },
  });

  // Store EmailBody
  await prisma.emailBody.create({
    data: {
      emailId: data.emailId,
      textBody: mainBody,
      htmlBody,
      quotedText: quotedContent || null,
      signature: signature || null,
      language,
    },
  });

  // Process attachments
  const attachments = parsed.attachments ?? [];
  const attachmentRecords: Array<{ id: string; s3Key: string; filename: string }> = [];

  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    try {
      const stored = await storeAttachment(attachment, data.emailId, i);

      const record = await prisma.emailAttachment.create({
        data: {
          emailId: data.emailId,
          filename: stored.filename,
          mimeType: stored.mimeType,
          size: stored.size,
          storagePath: stored.s3Key,
          contentId: attachment.contentId ?? null,
          isInline: attachment.contentDisposition === 'inline',
        },
      });

      attachmentRecords.push({ id: record.id, s3Key: stored.s3Key, filename: stored.filename });

      // Enqueue attachment processing
      await enqueue(QUEUE_NAMES.ATTACHMENT_PROCESS, 'process-attachment', {
        attachmentId: record.id,
        emailId: data.emailId,
        storagePath: stored.s3Key,
        filename: stored.filename,
        mimeType: stored.mimeType,
        size: stored.size,
      });
    } catch (err) {
      jobLog.error({ err, filename: attachment.filename }, 'Failed to process attachment');
    }
  }

  // Update status
  await prisma.email.update({
    where: { id: data.emailId },
    data: { status: 'parsed' },
  });

  // Enqueue to classify
  await enqueue(QUEUE_NAMES.EMAIL_CLASSIFY, 'classify-email', {
    emailId: data.emailId,
  });

  jobLog.info(
    { attachmentCount: attachmentRecords.length, language },
    'Email parse completed',
  );
}

export function createEmailParseWorker(): Worker {
  const worker = new Worker<EmailParseJobData>(
    QUEUE_NAMES.EMAIL_PARSE,
    async (job) => {
      await processJob(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: config.workers.emailParseConcurrency,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Email parse job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Email parse job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      moveToDlq(QUEUE_NAMES.EMAIL_PARSE, job.data, err).catch((dlqErr) => {
        log.error({ dlqErr }, 'Failed to move job to DLQ');
      });
    }
  });

  worker.on('error', (err) => {
    log.error({ err }, 'Email parse worker error');
  });

  log.info('Email parse worker started');
  return worker;
}
