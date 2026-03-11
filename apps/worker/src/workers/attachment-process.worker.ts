import { Worker, Job } from 'bullmq';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { createWorker, PSM } from 'tesseract.js';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';
import {
  getRedisConnection,
  QUEUE_NAMES,
  moveToDlq,
} from '../lib/queue-definitions.js';

const log = createChildLogger({ module: 'attachment-process-worker' });
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

interface AttachmentProcessJobData {
  attachmentId: string;
  emailId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
}

type AttachmentCategory =
  | 'requisites'
  | 'nameplate_photo'
  | 'article_photo'
  | 'price_list'
  | 'specification'
  | 'contract'
  | 'invoice'
  | 'drawing'
  | 'certificate'
  | 'general_document'
  | 'image'
  | 'archive'
  | 'unknown';

// Category detection by filename patterns
const FILENAME_CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: AttachmentCategory }> = [
  { pattern: /реквизит|requisit/i, category: 'requisites' },
  { pattern: /шильд|nameplate|табличк/i, category: 'nameplate_photo' },
  { pattern: /прайс|price[\s_-]?list/i, category: 'price_list' },
  { pattern: /спецификаци|specification|spec[\s_-]/i, category: 'specification' },
  { pattern: /договор|контракт|contract/i, category: 'contract' },
  { pattern: /счёт|счет|invoice/i, category: 'invoice' },
  { pattern: /чертёж|чертеж|drawing|dwg/i, category: 'drawing' },
  { pattern: /сертификат|certificate/i, category: 'certificate' },
];

// MIME type to category
const MIME_CATEGORIES: Record<string, AttachmentCategory> = {
  'application/zip': 'archive',
  'application/x-rar-compressed': 'archive',
  'application/x-7z-compressed': 'archive',
};

function categorizeAttachment(filename: string, mimeType: string): AttachmentCategory {
  // Check filename patterns first
  for (const { pattern, category } of FILENAME_CATEGORY_PATTERNS) {
    if (pattern.test(filename)) return category;
  }

  // Check MIME type
  if (MIME_CATEGORIES[mimeType]) return MIME_CATEGORIES[mimeType];

  // Generic categorization by MIME
  if (mimeType.startsWith('image/')) return 'image';
  if (
    mimeType === 'application/pdf' ||
    mimeType.includes('word') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel')
  ) {
    return 'general_document';
  }

  return 'unknown';
}

function isSuspiciousFile(filename: string, mimeType: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (config.attachment.quarantineExtensions.includes(`.${ext}`)) return true;
  if (mimeType === 'application/x-msdownload') return true;
  if (mimeType === 'application/x-executable') return true;
  // Double extension check
  const parts = filename.split('.');
  if (parts.length > 2) {
    const secondToLast = parts[parts.length - 2].toLowerCase();
    if (['pdf', 'doc', 'xls', 'jpg', 'png'].includes(secondToLast)) {
      const last = parts[parts.length - 1].toLowerCase();
      if (['exe', 'bat', 'cmd', 'scr', 'js', 'vbs'].includes(last)) return true;
    }
  }
  return false;
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // Basic PDF text extraction - look for text streams
  // For production, use a proper PDF library like pdf-parse
  const text = buffer.toString('utf-8', 0, Math.min(buffer.length, 1_000_000));
  const textBlocks: string[] = [];

  // Extract text between BT and ET markers (basic PDF text extraction)
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match: RegExpExecArray | null;
  while ((match = btEtRegex.exec(text)) !== null) {
    const block = match[1];
    // Extract text from Tj and TJ operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textBlocks.push(tjMatch[1]);
    }
  }

  return textBlocks.join(' ').trim();
}

async function performOcr(buffer: Buffer, lang: string = 'rus+eng'): Promise<string> {
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    worker = await createWorker(lang);
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
}

async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  // PDF extraction
  if (mimeType === 'application/pdf') {
    const pdfText = await extractTextFromPdf(buffer);
    if (pdfText.length > 50) return pdfText;
    // If PDF has little text, it might be a scanned document - try OCR
    // (Only for small PDFs to avoid long processing)
    if (buffer.length < 5 * 1024 * 1024) {
      try {
        return await performOcr(buffer);
      } catch (err) {
        log.warn({ err, filename }, 'OCR on PDF failed');
      }
    }
    return pdfText;
  }

  // Images - OCR
  if (mimeType.startsWith('image/')) {
    try {
      // Pre-process with sharp for better OCR results
      const sharp = (await import('sharp')).default;
      const processed = await sharp(buffer)
        .greyscale()
        .normalize()
        .sharpen()
        .toBuffer();
      return await performOcr(processed);
    } catch (err) {
      log.warn({ err, filename }, 'Image OCR failed');
      return '';
    }
  }

  // Plain text / CSV
  if (mimeType.startsWith('text/') || mimeType === 'application/csv') {
    return buffer.toString('utf-8');
  }

  // For DOCX/XLSX we would need dedicated parsers in production
  // Basic extraction: try to read as text
  if (mimeType.includes('word') || mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    // Extract readable strings from binary
    const text = buffer.toString('utf-8');
    const readable = text.replace(/[^\x20-\x7E\u0400-\u04FF\n\r\t]/g, ' ');
    return readable.replace(/\s{2,}/g, ' ').trim();
  }

  return '';
}

function detectContentType(
  extractedText: string,
  category: AttachmentCategory,
): AttachmentCategory {
  if (category !== 'general_document' && category !== 'image' && category !== 'unknown') {
    return category; // Already categorized by filename
  }

  const text = extractedText.toLowerCase();

  // Detect requisites
  if (
    (text.includes('инн') || text.includes('кпп') || text.includes('огрн')) &&
    (text.includes('р/с') || text.includes('расчётн') || text.includes('расчетн') || text.includes('банк'))
  ) {
    return 'requisites';
  }

  // Detect price list
  if (
    (text.includes('прайс') || text.includes('price')) &&
    (text.includes('цена') || text.includes('стоимость') || /\d+[\s,.]+\d{2}/.test(text))
  ) {
    return 'price_list';
  }

  // Detect specification
  if (
    text.includes('спецификаци') ||
    text.includes('specification') ||
    (text.includes('артикул') && text.includes('количество'))
  ) {
    return 'specification';
  }

  // Detect invoice
  if (
    (text.includes('счёт') || text.includes('счет') || text.includes('invoice')) &&
    (text.includes('оплат') || text.includes('итого') || text.includes('total'))
  ) {
    return 'invoice';
  }

  return category;
}

async function processJob(job: Job<AttachmentProcessJobData>): Promise<void> {
  const { data } = job;
  const jobLog = log.child({
    jobId: job.id,
    attachmentId: data.attachmentId,
    filename: data.filename,
  });

  jobLog.info('Starting attachment processing');

  // Check file size
  if (data.size > config.attachment.maxSizeBytes) {
    jobLog.warn({ size: data.size, maxSize: config.attachment.maxSizeBytes }, 'Attachment too large, skipping');
    await prisma.emailAttachment.update({
      where: { id: data.attachmentId },
      data: {
        category: 'oversized',
        processedAt: new Date(),
      },
    });
    return;
  }

  // Check for suspicious files
  if (isSuspiciousFile(data.filename, data.mimeType)) {
    jobLog.warn('Suspicious file detected, quarantining');
    await prisma.emailAttachment.update({
      where: { id: data.attachmentId },
      data: {
        category: 'quarantined',
        isQuarantined: true,
        processedAt: new Date(),
      },
    });
    return;
  }

  // Categorize by filename/mimetype
  let category = categorizeAttachment(data.filename, data.mimeType);

  // Fetch file from S3
  const s3Response = await s3.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: data.storagePath,
    }),
  );

  const bodyBytes = await s3Response.Body?.transformToByteArray();
  if (!bodyBytes) {
    throw new Error(`Empty body from S3 for key: ${data.storagePath}`);
  }
  const buffer = Buffer.from(bodyBytes);

  // Extract text
  let extractedText = '';
  try {
    extractedText = await extractText(buffer, data.mimeType, data.filename);
  } catch (err) {
    jobLog.warn({ err }, 'Text extraction failed');
  }

  // Refine category based on extracted text
  if (extractedText) {
    category = detectContentType(extractedText, category);
  }

  // Update attachment record
  await prisma.emailAttachment.update({
    where: { id: data.attachmentId },
    data: {
      category,
      extractedText: extractedText.slice(0, 100_000) || null, // Limit stored text
      processedAt: new Date(),
    },
  });

  jobLog.info(
    { category, textLength: extractedText.length },
    'Attachment processing completed',
  );
}

export function createAttachmentProcessWorker(): Worker {
  const worker = new Worker<AttachmentProcessJobData>(
    QUEUE_NAMES.ATTACHMENT_PROCESS,
    async (job) => {
      await processJob(job);
    },
    {
      connection: getRedisConnection(),
      concurrency: config.workers.attachmentProcessConcurrency,
    },
  );

  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'Attachment process job completed');
  });

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'Attachment process job failed');
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 2)) {
      moveToDlq(QUEUE_NAMES.ATTACHMENT_PROCESS, job.data, err).catch((dlqErr) => {
        log.error({ dlqErr }, 'Failed to move job to DLQ');
      });
    }
  });

  worker.on('error', (err) => {
    log.error({ err }, 'Attachment process worker error');
  });

  log.info('Attachment process worker started');
  return worker;
}
