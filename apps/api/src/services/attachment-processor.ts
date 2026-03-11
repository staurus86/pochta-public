import type { Logger } from 'pino';
import { config } from '../config.js';

export interface AttachmentInput {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string | null;
}

export interface AttachmentResult {
  category: string;
  extractedText: string | null;
  isQuarantined: boolean;
  quarantineReason: string | null;
}

const CATEGORY_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: 'requisites', pattern: /реквиз|card|details|банковские/i },
  { category: 'nameplate', pattern: /шильд|nameplate|табличка/i },
  { category: 'article_photo', pattern: /артикул|sku|label|этикетка/i },
  { category: 'price_list', pattern: /прайс|price|каталог|catalog/i },
  { category: 'invoice', pattern: /счет|invoice|счёт/i },
  { category: 'contract', pattern: /договор|contract|соглашение/i },
  { category: 'technical', pattern: /техническ|specification|datasheet|чертеж|drawing/i },
];

const SUSPICIOUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.js',
  '.wsf', '.msi', '.dll', '.ps1', '.hta', '.cpl',
]);

const MIME_PDF = 'application/pdf';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/tiff', 'image/webp', 'image/bmp']);

export class AttachmentProcessor {
  constructor(private log: Logger) {}

  async process(attachment: AttachmentInput): Promise<AttachmentResult> {
    // Step 1: Check for suspicious files
    const quarantine = this.quarantineIfSuspicious(attachment);
    if (quarantine) {
      return quarantine;
    }

    // Step 2: Detect category
    const category = this.detectCategory(attachment.filename, attachment.mimeType);

    // Step 3: Extract text based on mime type
    let extractedText: string | null = null;

    try {
      if (attachment.mimeType === MIME_PDF) {
        extractedText = await this.extractTextFromPdf(attachment);
      } else if (attachment.mimeType === MIME_DOCX) {
        extractedText = await this.extractTextFromDocx(attachment);
      } else if (IMAGE_MIMES.has(attachment.mimeType)) {
        extractedText = await this.ocrImage(attachment);
      }
    } catch (err) {
      this.log.warn(
        { err, attachmentId: attachment.id, mime: attachment.mimeType },
        'Failed to extract text from attachment',
      );
    }

    return {
      category,
      extractedText,
      isQuarantined: false,
      quarantineReason: null,
    };
  }

  /**
   * Detect the functional category of an attachment based on filename and mime.
   */
  detectCategory(filename: string, mimeType: string): string {
    const lowerName = filename.toLowerCase();

    for (const { category, pattern } of CATEGORY_PATTERNS) {
      if (pattern.test(lowerName)) {
        return category;
      }
    }

    // Fallback by mime type
    if (IMAGE_MIMES.has(mimeType)) return 'image';
    if (mimeType === MIME_PDF) return 'document';
    if (mimeType === MIME_DOCX) return 'document';
    if (mimeType.startsWith('text/')) return 'text';

    return 'other';
  }

  /**
   * Extract text content from a PDF file.
   */
  async extractTextFromPdf(attachment: AttachmentInput): Promise<string | null> {
    if (!attachment.storagePath) {
      this.log.debug({ attachmentId: attachment.id }, 'No storage path for PDF extraction');
      return null;
    }

    // Dynamic import to avoid loading heavy deps at startup
    try {
      const { readFile } = await import('node:fs/promises');
      const buffer = await readFile(attachment.storagePath);

      // Use a simple text layer extraction approach
      // In production, use pdf-parse or similar
      const text = buffer.toString('utf-8');
      const extracted = text.match(/[\w\s\u0400-\u04FF]{10,}/g);
      return extracted ? extracted.join(' ').slice(0, 10000) : null;
    } catch (err) {
      this.log.warn({ err, attachmentId: attachment.id }, 'PDF text extraction failed');
      return null;
    }
  }

  /**
   * Extract text content from a DOCX file.
   */
  async extractTextFromDocx(attachment: AttachmentInput): Promise<string | null> {
    if (!attachment.storagePath) {
      this.log.debug({ attachmentId: attachment.id }, 'No storage path for DOCX extraction');
      return null;
    }

    try {
      const { readFile } = await import('node:fs/promises');
      const buffer = await readFile(attachment.storagePath);

      // DOCX is a zip file; extract document.xml content
      // In production, use mammoth or docx-parser
      const text = buffer.toString('utf-8');
      // Simple extraction of text between XML tags
      const cleaned = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return cleaned.slice(0, 10000) || null;
    } catch (err) {
      this.log.warn({ err, attachmentId: attachment.id }, 'DOCX text extraction failed');
      return null;
    }
  }

  /**
   * Perform OCR on an image attachment using tesseract.js.
   */
  async ocrImage(attachment: AttachmentInput): Promise<string | null> {
    if (!attachment.storagePath) {
      this.log.debug({ attachmentId: attachment.id }, 'No storage path for OCR');
      return null;
    }

    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('rus+eng');

      const { data: { text } } = await worker.recognize(attachment.storagePath);
      await worker.terminate();

      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed.slice(0, 10000) : null;
    } catch (err) {
      this.log.warn({ err, attachmentId: attachment.id }, 'OCR failed');
      return null;
    }
  }

  /**
   * Quarantine suspicious attachments (executables, scripts, etc.).
   */
  quarantineIfSuspicious(attachment: AttachmentInput): AttachmentResult | null {
    const ext = attachment.filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';

    if (SUSPICIOUS_EXTENSIONS.has(ext)) {
      this.log.warn(
        { attachmentId: attachment.id, filename: attachment.filename, ext },
        'Suspicious attachment quarantined',
      );

      return {
        category: 'quarantined',
        extractedText: null,
        isQuarantined: true,
        quarantineReason: `Suspicious file extension: ${ext}`,
      };
    }

    // Check for oversized files
    const maxBytes = config.ATTACHMENT_MAX_SIZE_MB * 1024 * 1024;
    if (attachment.size > maxBytes) {
      this.log.warn(
        { attachmentId: attachment.id, size: attachment.size, maxBytes },
        'Oversized attachment quarantined',
      );

      return {
        category: 'quarantined',
        extractedText: null,
        isQuarantined: true,
        quarantineReason: `File size ${(attachment.size / 1024 / 1024).toFixed(1)}MB exceeds limit of ${config.ATTACHMENT_MAX_SIZE_MB}MB`,
      };
    }

    // Check for double extensions (e.g., document.pdf.exe)
    const doubleExtMatch = attachment.filename.match(/\.[^.]+\.[^.]+$/);
    if (doubleExtMatch) {
      const lastExt = attachment.filename.match(/\.[^.]+$/)?.[0] ?? '';
      if (SUSPICIOUS_EXTENSIONS.has(lastExt)) {
        return {
          category: 'quarantined',
          extractedText: null,
          isQuarantined: true,
          quarantineReason: `Double extension with suspicious final ext: ${doubleExtMatch[0]}`,
        };
      }
    }

    return null;
  }
}
