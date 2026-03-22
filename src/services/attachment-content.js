import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectionKb } from "./detection-kb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTACHMENTS_ROOT = path.resolve(__dirname, "../../data/attachments");

const DEFAULT_LIMITS = {
  maxFiles: 8,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxExtractedCharsPerFile: 12000,
  maxCombinedChars: 24000,
  maxBudgetMs: 1500
};

const TEXT_EXTENSIONS = new Set([
  ".txt", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".eml", ".log", ".md"
]);

const PDF_EXTENSIONS = new Set([".pdf"]);
const PHASE2_EXTENSIONS = new Set([".docx", ".xlsx", ".xls", ".doc"]);

const INN_PATTERN = /\b\d{10,12}\b/g;
const KPP_PATTERN = /\b\d{9}\b/g;
const OGRN_PATTERN = /\b\d{13,15}\b/g;
const ARTICLE_PATTERN = /\b([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9./:_-]{2,})\b/gi;

export function analyzeStoredAttachments(messageKey, attachmentFiles = [], options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const startedAt = Date.now();
  const files = [];
  const textParts = [];
  let processedCount = 0;
  let skippedCount = 0;
  let totalBytes = 0;
  let totalChars = 0;

  for (const attachment of attachmentFiles || []) {
    const filename = attachment?.filename || attachment?.name || "";
    const safeName = attachment?.safeName || sanitizeFilename(filename);
    const contentType = attachment?.contentType || "";
    const size = Number(attachment?.size || 0);
    const ext = path.extname(filename || safeName || "").toLowerCase();
    const result = {
      filename,
      safeName: safeName || null,
      contentType: contentType || null,
      size,
      ext,
      status: "skipped",
      reason: null,
      extractedChars: 0,
      category: categorizeAttachment(filename, ext, contentType),
      preview: null,
      detectedArticles: [],
      detectedBrands: [],
      detectedInn: [],
      detectedKpp: [],
      detectedOgrn: []
    };

    if (processedCount >= limits.maxFiles) {
      result.reason = `batch_limit:${limits.maxFiles}`;
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (Date.now() - startedAt > limits.maxBudgetMs) {
      result.reason = `time_budget:${limits.maxBudgetMs}ms`;
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (size > limits.maxFileBytes) {
      result.reason = `file_too_large:${limits.maxFileBytes}`;
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (totalBytes + size > limits.maxTotalBytes) {
      result.reason = `total_size_budget:${limits.maxTotalBytes}`;
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (PHASE2_EXTENSIONS.has(ext)) {
      result.reason = "phase2_format";
      files.push(result);
      skippedCount += 1;
      continue;
    }

    if (!TEXT_EXTENSIONS.has(ext) && !PDF_EXTENSIONS.has(ext)) {
      result.reason = "unsupported_format";
      files.push(result);
      skippedCount += 1;
      continue;
    }

    const filePath = safeName ? path.join(ATTACHMENTS_ROOT, messageKey, safeName) : null;
    if (!filePath || !existsSync(filePath)) {
      result.reason = "missing_on_disk";
      files.push(result);
      skippedCount += 1;
      continue;
    }

    try {
      const buffer = readFileSync(filePath);
      totalBytes += buffer.length;
      let extractedText = "";

      if (TEXT_EXTENSIONS.has(ext)) {
        extractedText = extractTextFromPlainBuffer(buffer);
      } else if (PDF_EXTENSIONS.has(ext)) {
        extractedText = extractTextFromPdfBuffer(buffer);
      }

      extractedText = cleanupExtractedText(extractedText).slice(0, limits.maxExtractedCharsPerFile);
      if (!extractedText) {
        result.reason = "no_text_extracted";
        files.push(result);
        skippedCount += 1;
        continue;
      }

      if (PDF_EXTENSIONS.has(ext) && !isUsablePdfText(extractedText)) {
        result.reason = "low_quality_pdf_text";
        result.preview = extractedText.slice(0, 200);
        files.push(result);
        skippedCount += 1;
        continue;
      }

      processedCount += 1;
      result.status = "processed";
      result.extractedChars = extractedText.length;
      result.preview = extractedText.slice(0, 400);
      result.detectedArticles = detectAttachmentArticles(extractedText);
      result.detectedBrands = detectionKb.detectBrands(extractedText, []);
      result.detectedInn = uniqueMatches(extractedText, INN_PATTERN).filter((value) => value.length === 10 || value.length === 12);
      result.detectedKpp = uniqueMatches(extractedText, KPP_PATTERN);
      result.detectedOgrn = uniqueMatches(extractedText, OGRN_PATTERN).filter((value) => value.length === 13 || value.length === 15);

      if (totalChars < limits.maxCombinedChars) {
        const remaining = limits.maxCombinedChars - totalChars;
        const chunk = extractedText.slice(0, remaining);
        if (chunk) {
          textParts.push(`Вложение: ${filename}\n${chunk}`);
          totalChars += chunk.length;
        }
      }
    } catch (error) {
      result.reason = `read_error:${error.message}`;
      skippedCount += 1;
    }

    files.push(result);
  }

  return {
    files,
    combinedText: textParts.join("\n\n").trim(),
    meta: {
      processedCount,
      skippedCount,
      totalBytes,
      totalChars,
      budgetMs: Date.now() - startedAt,
      limits
    }
  };
}

function sanitizeFilename(filename) {
  return String(filename || "").replace(/[<>:"/\\|?*]/g, "_");
}

function categorizeAttachment(filename, ext, contentType) {
  const lower = String(filename || "").toLowerCase();
  if (/реквиз|card|details|банк/i.test(lower)) return "requisites";
  if (/сч[её]т|invoice/i.test(lower)) return "invoice";
  if (/спецификац|specification|spec/i.test(lower)) return "specification";
  if (/прайс|price/i.test(lower)) return "price_list";
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (PHASE2_EXTENSIONS.has(ext)) return "phase2_document";
  if ((contentType || "").startsWith("image/")) return "image";
  return "other";
}

function extractTextFromPlainBuffer(buffer) {
  return buffer.toString("utf8");
}

function extractTextFromPdfBuffer(buffer) {
  const text = buffer.toString("latin1", 0, Math.min(buffer.length, 1024 * 1024));
  const parts = [];

  for (const match of text.matchAll(/\(([^()]*)\)\s*Tj/g)) {
    parts.push(match[1]);
  }

  for (const match of text.matchAll(/\[(.*?)\]\s*TJ/g)) {
    const chunk = match[1];
    for (const sub of chunk.matchAll(/\(([^()]*)\)/g)) {
      parts.push(sub[1]);
    }
  }

  if (parts.length === 0) {
    for (const match of text.matchAll(/[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\s.,;:()"/\\_-]{15,}/g)) {
      parts.push(match[0]);
    }
  }

  return parts.join(" ");
}

function cleanupExtractedText(text) {
  return String(text || "")
    .replace(/\\([()\\])/g, "$1")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsablePdfText(text) {
  const sample = String(text || "").slice(0, 4000);
  const badMarkers = (sample.match(/(?:Filter|FlateDecode|Type\/|XObject|BaseFont|FontDescriptor|ColorSpace|BitsPerComponent|DCTDecode|CIDFont|ToUnicode)/gi) || []).length;
  const slashTokens = (sample.match(/\/[A-Za-z][A-Za-z0-9]+/g) || []).length;
  const cyrillicWords = (sample.match(/[А-Яа-яЁё]{3,}/g) || []).length;
  const latinWords = (sample.match(/[A-Za-z]{4,}/g) || []).length;
  const naturalWords = cyrillicWords + latinWords;

  if (badMarkers >= 3) return false;
  if (slashTokens >= 8 && naturalWords < 12) return false;
  if (naturalWords < 6) return false;
  return true;
}

function detectAttachmentArticles(text) {
  return uniqueMatches(text.toUpperCase(), ARTICLE_PATTERN)
    .filter((value) => value.length >= 4)
    .filter((value) => /\d/.test(value))
    .filter((value) => !/^(ИНН|КПП|ОГРН)$/.test(value))
    .slice(0, 30);
}

function uniqueMatches(text, pattern) {
  return [...new Set(Array.from(String(text || "").matchAll(pattern), (match) => String(match[1] || match[0] || "").trim()).filter(Boolean))];
}
